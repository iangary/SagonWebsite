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

const emailSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const phoneSchema = z.object({
  phone: z.string().min(1),
  code: z.string().min(4),
})

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
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
      name: 'Email 與密碼',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: '密碼', type: 'password' },
      },
      async authorize(raw) {
        const parsed = emailSchema.safeParse(raw)
        if (!parsed.success) return null

        const user = await db.user.findUnique({
          where: { email: parsed.data.email.toLowerCase() },
        })
        // 只用 Google 註冊的人沒有 passwordHash，這條路直接不通
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
