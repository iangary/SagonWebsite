import NextAuth from 'next-auth'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { PrismaAdapter } from '@auth/prisma-adapter'
import Google from 'next-auth/providers/google'
import Line from 'next-auth/providers/line'
import Facebook from 'next-auth/providers/facebook'
import Credentials from 'next-auth/providers/credentials'
import { CredentialsSignin } from 'next-auth'
import { z } from 'zod'

import { db } from '@/lib/db'
import { claimAnonCart } from '@/lib/cart/shared'
import { env, isGoogleAuthEnabled, isLineAuthEnabled, isFacebookAuthEnabled } from '@/lib/env'
import { authConfig } from './config'
import { verifyPassword } from './password'
import { verifyOtp } from './otp'
import { normalizeTwMobile } from '@/lib/sms/provider'
import { toLocale } from '@/i18n/config'
import { clientIp, peekRateLimit, recordRateLimitHit } from '@/lib/rate-limit'

/**
 * 密碼登入的失敗次數上限（15 分鐘視窗，只算失敗）。
 * 帳號維度擋針對單一會員猜密碼；IP 維度擋一台機器撞一堆帳號（撞庫）。
 * argon2 每次驗證約 19 MiB 記憶體，不擋的話大量登入請求本身就能把 1g 的容器打掛。
 */
const LOGIN_WINDOW_SECONDS = 15 * 60
const LOGIN_FAILURES_PER_ACCOUNT = 10
const LOGIN_FAILURES_PER_IP = 30

/** 前端靠 signIn() 回傳的 code 分辨「被節流」與「帳密錯誤」 */
class LoginRateLimited extends CredentialsSignin {
  code = 'rate_limited'
}

const passwordSchema = z.object({
  /** 手機號碼或 Email —— 手機註冊的會員沒有 Email，只能用號碼當帳號 */
  identifier: z.string().trim().min(1),
  password: z.string().min(1),
})

const phoneSchema = z.object({
  phone: z.string().min(1),
  code: z.string().min(4),
})

/** token 上的 role 與 sessionVersion 最多能舊多久（毫秒）。見下方 jwt callback。 */
const ROLE_TTL_MS = 5 * 60 * 1000

/**
 * 「目前這個 session 可以跟上新的 sessionVersion」的證明。
 *
 * 會員在帳號安全頁改密碼時，要把**其他**裝置踢掉、但留住自己這一個。
 * update() 從瀏覽器也打得到，不能讓 client 自己送一個新的 sessionVersion 進來 ——
 * 舊 session 的持有人（也就是我們要踢掉的人）會照做。所以由 server action 用 AUTH_SECRET
 * 簽一份證明，jwt callback 驗過才接受。
 */
function sessionVersionProof(userId: string, version: number): string {
  return createHmac('sha256', env.AUTH_SECRET)
    .update(`session-version:${userId}:${version}`)
    .digest('base64url')
}

/** 改密碼的 server action 用：讓呼叫者自己的 session 跟上新版本，其他裝置照樣作廢 */
export async function keepCurrentSessionAfterPasswordChange(userId: string, version: number) {
  await unstable_update({
    user: { sessionVersion: version, sessionVersionProof: sessionVersionProof(userId, version) },
  } as never)
}

function isValidSessionVersionProof(userId: string, version: unknown, proof: unknown): boolean {
  if (typeof version !== 'number' || typeof proof !== 'string') return false
  const expected = Buffer.from(sessionVersionProof(userId, version))
  const given = Buffer.from(proof)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

/**
 * unstable_update 是 Auth.js v5 的 server 端 session 更新。
 * 名字帶 unstable 但它是 v5 唯一能從 server action 改 JWT 的官方入口 ——
 * client 的 useSession().update() 在 provider 還在 loading 時會靜默 no-op
 * （見 node_modules/next-auth/react.js 的 `if (loading) return`），
 * 整頁載入後的 /set-password 正好是那個狀態，所以旗標一定要在 server 清。
 */
export const { handlers, signIn, signOut, auth, unstable_update } = NextAuth({
  ...authConfig,

  callbacks: {
    ...authConfig.callbacks,

    /**
     * 先跑 edge-safe 的那份（釘 id/role/phone/locale/needsPassword），
     * 再用資料庫把 needsPassword 與 role 修正回真實狀態。
     *
     * 為什麼需要這一步：`/api/auth/session` 每被打一次就會用它讀到的 token
     * **重新簽發 cookie**。SessionProvider 在頁面掛載時就會打它，若剛好和
     * 「設完密碼、清掉旗標」的那個回應交錯，舊 token 會把新 cookie 蓋回去，
     * 使用者於是被 proxy 一直彈回 /set-password（dev 冷編譯時穩定重現）。
     * 讓 token 每次重簽都對照一次資料庫，這種覆寫就自己痊癒了 ——
     * 也順便處理「在另一台裝置設過密碼、這台 token 還是舊的」。
     *
     * 只有旗標為真時才查（等於只在「還沒設密碼」那段極短的期間），不是每次登入都查。
     * 這個 callback 跑在 Node route handler 裡，碰得到 Prisma；proxy 只用 getToken()
     * 解 JWT，不會走到這裡。
     */
    /**
     * Google 沒驗證過的 email 不准登入。
     *
     * Google 開著 allowDangerousEmailAccountLinking（同 email 自動併入既有會員），
     * 這個前提是「Google 回來的 email 確實屬於登入的人」。絕大多數 Google 帳號都是驗證過的，
     * 但 profile 上有明確的 email_verified 欄位，就不要賭。
     * 只有原始 profile 在這裡看得到，events.linkAccount 拿到的是已經正規化過的 user。
     */
    async signIn({ account, profile }) {
      if (account?.provider === 'google' && profile?.email_verified === false) return false
      return true
    },

    async jwt(params) {
      // update() 可以從瀏覽器直接呼叫（POST /api/auth/session），送什麼 config.ts 就收什麼。
      // 先記住原本的值，下面再對照資料庫，免得有人自己送 needsPassword:false 跳過設定密碼頁、
      // 或送一個不是他的 phone 進 token。
      const before = { needsPassword: params.token?.needsPassword, phone: params.token?.phone }
      const token = await authConfig.callbacks.jwt(params)

      if (params.trigger === 'update' && typeof token?.id === 'string') {
        const patch = (params.session as { user?: Record<string, unknown> } | undefined)?.user
        if (isValidSessionVersionProof(token.id, patch?.sessionVersion, patch?.sessionVersionProof)) {
          token.sessionVersion = patch!.sessionVersion as number
        }

        const touchedPhone = token.phone !== before.phone
        const unlocked = before.needsPassword === true && token.needsPassword !== true
        if (touchedPhone || unlocked) {
          const user = await db.user.findUnique({
            where: { id: token.id },
            select: { phone: true, passwordHash: true },
          })
          if (touchedPhone) token.phone = user?.phone ?? null
          if (unlocked && !user?.passwordHash) token.needsPassword = true
        }
      }

      if (token?.needsPassword && typeof token.id === 'string') {
        const user = await db.user.findUnique({
          where: { id: token.id },
          select: { passwordHash: true },
        })
        if (user?.passwordHash) token.needsPassword = false
      }

      /**
       * role 每隔 ROLE_TTL_MS 對照一次資料庫。
       *
       * proxy 只解 JWT、碰不到 Prisma（見 src/proxy.ts 檔頭），所以 token 上的 role
       * 就是進不進得了 /admin 的唯一依據。後台把某位會員設成管理員之後，若不重簽 token，
       * 他的 role 會一直是 CUSTOMER —— 最久要等 30 天（session maxAge）才生效。
       *
       * `/api/auth/session` 每被打一次就會用這裡算出的 token 重新簽發 cookie，
       * 而 SessionProvider 在每次頁面掛載時都會打它，所以對方只要載入前台任何一頁，
       * proxy 下一個請求就看得到新權限，不必登出再登入。
       *
       * 節流的理由是這個 callback 在每次讀 session 時都會跑。釘上時間戳之後，
       * 成本降成「每位使用者每 5 分鐘一次主鍵查詢」，而不是每個請求一次。
       * 撤權不靠這段（那會慢上 5 分鐘），由 requireAdmin() 與後台 layout 當場對資料庫。
       */
      if (typeof token?.id === 'string' && Date.now() - (token.roleCheckedAt ?? 0) > ROLE_TTL_MS) {
        const user = await db.user.findUnique({
          where: { id: token.id },
          select: { role: true, sessionVersion: true },
        })
        // 帳號被刪了，或改過密碼（sessionVersion 變了）→ 這個 session 作廢。
        // 回 null 會讓 Auth.js 清掉 session cookie；舊 token 沒有這欄就視同 0。
        if (!user || user.sessionVersion !== (token.sessionVersion ?? 0)) return null
        token.role = user.role
        token.roleCheckedAt = Date.now()
      }
      return token
    },
  },

  adapter: PrismaAdapter(db),
  secret: env.AUTH_SECRET,
  trustHost: true,

  providers: [
    ...(isGoogleAuthEnabled
      ? [
          Google({
            clientId: env.AUTH_GOOGLE_ID,
            clientSecret: env.AUTH_GOOGLE_SECRET,
            // Google 的 email 一定是驗證過的，所以用同一個 email 註冊過密碼的人
            // 可以直接用 Google 登入同一個帳號，而不是被擋掉或開出第二個帳號。
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),

    ...(isLineAuthEnabled
      ? [
          Line({
            clientId: env.AUTH_LINE_ID,
            clientSecret: env.AUTH_LINE_SECRET,
            // LINE 的 email 需要另外申請「Email address permission」才拿得到，
            // 沒過審或使用者拒絕授權時 profile.email 會是 undefined —— 見下方 createUser。
            //
            // 不開 allowDangerousEmailAccountLinking：LINE 沒有保證回傳的 email 驗證過，
            // 開了等於「誰能在 LINE 填上你的信箱，誰就能登進你的會員帳號」。
            // 同 email 的既有會員會看到 ssoEmailTaken，請他用原本的方式登入後到帳號安全頁綁定。
          }),
        ]
      : []),

    ...(isFacebookAuthEnabled
      ? [
          Facebook({
            clientId: env.AUTH_FACEBOOK_ID,
            clientSecret: env.AUTH_FACEBOOK_SECRET,
            // email 權限只有「進階存取」才對一般用戶生效；用手機註冊的 FB 帳號
            // 本來就可能沒有 email，兩種情況 profile.email 都會是 null —— 見下方 createUser。
            //
            // 不開 allowDangerousEmailAccountLinking，理由同 LINE。
          }),
        ]
      : []),

    Credentials({
      id: 'password',
      name: '帳號與密碼',
      credentials: {
        identifier: { label: '手機號碼或 Email', type: 'text' },
        password: { label: '密碼', type: 'password' },
      },
      async authorize(raw, request) {
        const parsed = passwordSchema.safeParse(raw)
        if (!parsed.success) return null

        // 號碼先正規化，免得換個寫法（0912-345-678）就換一個計數桶
        const account =
          normalizeTwMobile(parsed.data.identifier) ?? parsed.data.identifier.toLowerCase()
        const accountKey = `login:id:${account}`
        const ipKey = `login:ip:${clientIp(request.headers)}`
        const [byAccount, byIp] = await Promise.all([
          peekRateLimit(accountKey, LOGIN_FAILURES_PER_ACCOUNT),
          peekRateLimit(ipKey, LOGIN_FAILURES_PER_IP),
        ])
        if (!byAccount.ok || !byIp.ok) throw new LoginRateLimited()

        const user = await findPasswordUser(parsed.data.identifier)
        const ok = user?.passwordHash
          ? await verifyPassword(user.passwordHash, parsed.data.password)
          : false
        if (!user || !ok) {
          await Promise.all([
            recordRateLimitHit(accountKey, LOGIN_WINDOW_SECONDS),
            recordRateLimitHit(ipKey, LOGIN_WINDOW_SECONDS),
          ])
          return null
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role,
          phone: user.phone,
          // 資料庫是 TEXT，收斂成 Locale 才對得上 next-auth.d.ts 的字面量聯集
          locale: toLocale(user.locale),
          needsPassword: false,
          sessionVersion: user.sessionVersion,
        }
      },
    }),

    Credentials({
      id: 'phone-otp',
      name: '手機驗證碼',
      credentials: {
        phone: { label: '手機號碼', type: 'tel' },
        code: { label: '驗證碼', type: 'text' },
      },
      async authorize(raw) {
        const parsed = phoneSchema.safeParse(raw)
        if (!parsed.success) return null

        const result = await verifyOtp(parsed.data.phone, parsed.data.code, 'login')
        if (!result.ok) return null

        const phone = result.phone
        // 手機登入等同註冊：沒有這支號碼就直接開一個會員
        const user = await db.user.upsert({
          where: { phone },
          update: { phoneVerified: new Date() },
          create: {
            phone,
            phoneVerified: new Date(),
            name: `會員${phone.slice(-4)}`,
          },
        })

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role,
          phone: user.phone,
          // 資料庫是 TEXT，收斂成 Locale 才對得上 next-auth.d.ts 的字面量聯集
          locale: toLocale(user.locale),
          // 還沒有密碼就代表這是第一次用簡訊進來。旗標帶進 token，
          // proxy 會把他擋在設定密碼頁，之後就能用號碼＋密碼登入、不必再發簡訊。
          needsPassword: !user.passwordHash,
          sessionVersion: user.sessionVersion,
        }
      },
    }),
  ],

  events: {
    /**
     * Google 自動併入既有帳號時，作廢「沒人證明過信箱」的那組密碼。
     *
     * Google 開著 allowDangerousEmailAccountLinking，所以 Google 回來的 email 若已經是
     * 會員，就會直接登進那個帳號。但那個帳號可能是別人搶先用這個信箱註冊的：
     * 註冊不需要先驗證信箱，攻擊者可以拿受害者的 Gmail 先開帳號、設好自己的密碼，
     * 等受害者哪天按「Google 登入」就被併進去 —— 之後受害者下的訂單、填的地址，
     * 攻擊者用那組密碼都看得到。
     *
     * Google 驗證過的 email 就是信箱主人的證明（未驗證的在 signIn callback 就擋掉了），所以這時：
     * - emailVerified 還是空的 → 密碼是誰設的沒人知道，清掉；同時把信箱標成已驗證。
     *   真的是本人的話，到帳號安全頁重設一組就好（SSO 會員設密碼不需要舊密碼）。
     * - emailVerified 已經有值 → 密碼確實是信箱主人設的，不動。
     *
     * 只看「Google 給的 email 等於帳號 email」的情況：已登入的會員在帳號安全頁綁一個
     * 不同信箱的 Google 也會走到這裡，那種綁定跟搶註無關，不該清他的密碼。
     */
    async linkAccount({ user, account, profile }) {
      if (account.provider !== 'google' || !user.id) return
      const googleEmail = typeof profile?.email === 'string' ? profile.email.toLowerCase() : null
      // email_verified 已經在 signIn callback 擋過，走到這裡的 Google email 都是驗證過的
      if (!googleEmail) return

      const existing = await db.user.findUnique({
        where: { id: user.id },
        select: { email: true, emailVerified: true, passwordHash: true },
      })
      if (!existing || existing.email?.toLowerCase() !== googleEmail || existing.emailVerified) return

      await db.user.update({
        where: { id: user.id },
        data: { emailVerified: new Date(), ...(existing.passwordHash ? { passwordHash: null } : {}) },
      })
      if (existing.passwordHash) {
        console.warn(`[auth] Google 併入未驗證信箱的帳號，已作廢原密碼 userId=${user.id}`)
      }
    },

    /**
     * 登入成功的當下把匿名購物車併進會員車。
     *
     * 不能只靠 getOrCreateCart() 裡那段合併 —— 那條路只有 Server Action 走得到，
     * 登入後直接看 /cart 是純讀取，會員車只要存在（先前登入過就會留下一列，
     * 就算是空的）匿名車就整台被擋在外面。症狀是「登入後購物車空了，
     * 但隨便按一次『直接購買』東西又全部回來」。
     *
     * 這個 event 對四種登入方式都會觸發（密碼、手機驗證碼、SSO 的 callback），
     * 而且跑在 /api/auth 的 route handler 裡，所以讀得到 cookie 也碰得到 Prisma。
     * 併車失敗不該擋下登入，所以整段包在 try/catch 裡：東西還在匿名車上，
     * 下一個 Server Action（加購物車、改數量、結帳）會再併一次。
     */
    async signIn({ user }) {
      if (!user?.id) return
      try {
        await claimAnonCart(user.id)
      } catch (error) {
        console.error('[auth] 併入匿名購物車失敗', error)
      }
    },

    /**
     * PrismaAdapter 建立 SSO 使用者時不會帶 phone/role，
     * 這裡補一次 email 正規化，避免大小寫不同被當成兩個人。
     *
     * 注意：LINE 沒拿到 email 權限時 user.email 會是 null，這是允許的
     * （schema 上 email 為 optional），但這種會員收不到訂單通知信，
     * 結帳流程必須另外要求補 email 或手機。
     */
    async createUser({ user }) {
      if (user.email && user.email !== user.email.toLowerCase()) {
        await db.user.update({
          where: { id: user.id },
          data: { email: user.email.toLowerCase() },
        })
      }
    },
  },
})

export { normalizeTwMobile }

/**
 * 密碼登入用的帳號查詢。09xxxxxxxx 當手機、其餘當 Email —— 兩者在 schema 上都是唯一鍵，
 * 所以不會有「同一個字串同時是兩個人的帳號」的問題。
 * 只用 SSO 註冊、或還沒設密碼的手機會員沒有 passwordHash，呼叫端會當成登入失敗。
 */
async function findPasswordUser(identifier: string) {
  const phone = normalizeTwMobile(identifier)
  return phone
    ? db.user.findUnique({ where: { phone } })
    : db.user.findUnique({ where: { email: identifier.toLowerCase() } })
}

/** 取得目前登入者；未登入回 null。 */
export async function currentUser() {
  const session = await auth()
  return session?.user ?? null
}

/** 頁面/Server Action 用的守衛：未登入直接丟錯。 */
export async function requireUser() {
  const user = await currentUser()
  if (!user) throw new Error('UNAUTHENTICATED')
  return user
}

/**
 * 目前的權限是否真的是管理員 —— 直接問資料庫，不看 token。
 *
 * session 上的 role 最多會舊 5 分鐘（見上方 jwt callback 的節流）。授權可以慢，
 * **撤權不行**：把某人的管理員權限移掉之後，他不該還有五分鐘可以改商品或看訂單。
 */
export async function isDbAdmin(userId: string): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true } })
  return user?.role === 'ADMIN'
}

/** 後台守衛（Server Action / API 用）。 */
export async function requireAdmin() {
  const user = await currentUser()
  // 先看 token 擋掉絕大多數請求，確定是管理員才花一次查詢確認權限還在
  if (!user || user.role !== 'ADMIN') throw new Error('FORBIDDEN')
  if (!(await isDbAdmin(user.id))) throw new Error('FORBIDDEN')
  return user
}
