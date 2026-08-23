import NextAuth from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import Google from 'next-auth/providers/google'
import Line from 'next-auth/providers/line'
import Facebook from 'next-auth/providers/facebook'
import Credentials from 'next-auth/providers/credentials'
import { z } from 'zod'

import { db } from '@/lib/db'
import { env, isGoogleAuthEnabled, isLineAuthEnabled, isFacebookAuthEnabled } from '@/lib/env'
import { authConfig } from './config'
import { verifyPassword } from './password'
import { verifyOtp } from './otp'
import { normalizeTwMobile } from '@/lib/sms/provider'
import { toLocale } from '@/i18n/config'

const passwordSchema = z.object({
  /** 手機號碼或 Email —— 手機註冊的會員沒有 Email，只能用號碼當帳號 */
  identifier: z.string().trim().min(1),
  password: z.string().min(1),
})

const phoneSchema = z.object({
  phone: z.string().min(1),
  code: z.string().min(4),
})

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
     * 再用資料庫把 needsPassword 修正回真實狀態。
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
    async jwt(params) {
      const token = await authConfig.callbacks.jwt(params)
      if (token?.needsPassword && typeof token.id === 'string') {
        const user = await db.user.findUnique({
          where: { id: token.id },
          select: { passwordHash: true },
        })
        if (user?.passwordHash) token.needsPassword = false
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
            allowDangerousEmailAccountLinking: true,
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
            allowDangerousEmailAccountLinking: true,
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
      async authorize(raw) {
        const parsed = passwordSchema.safeParse(raw)
        if (!parsed.success) return null

        // 09xxxxxxxx 當手機、其餘當 Email。兩者在 schema 上都是唯一鍵，
        // 所以不會有「同一個字串同時是兩個人的帳號」的問題。
        const phone = normalizeTwMobile(parsed.data.identifier)
        const user = phone
          ? await db.user.findUnique({ where: { phone } })
          : await db.user.findUnique({ where: { email: parsed.data.identifier.toLowerCase() } })

        // 只用 Google 註冊、或還沒設密碼的手機會員沒有 passwordHash，這條路直接不通
        if (!user?.passwordHash) return null

        const ok = await verifyPassword(user.passwordHash, parsed.data.password)
        if (!ok) return null

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
        }
      },
    }),
  ],

  events: {
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

/** 後台守衛。 */
export async function requireAdmin() {
  const user = await currentUser()
  if (!user || user.role !== 'ADMIN') throw new Error('FORBIDDEN')
  return user
}
