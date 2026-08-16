import type { NextAuthConfig } from 'next-auth'
import { toLocale } from '@/i18n/config'

/**
 * Edge-safe 的 Auth.js 基礎設定。
 *
 * middleware 跑在 edge runtime，碰不到 Prisma 與 argon2（原生模組），
 * 所以這裡只放「解 JWT 就能做完」的東西：pages、session 策略、token/session callback。
 * 真正需要 DB 的 providers 與 adapter 在 src/lib/auth/index.ts。
 */
export const authConfig = {
  // Credentials provider 不支援 database session，全站統一用 JWT。
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },

  pages: {
    signIn: '/login',
    error: '/login',
  },

  callbacks: {
    async jwt({ token, user, trigger, session }) {
      // 首次登入時 user 才有值，把要放進 session 的欄位釘進 token
      if (user) {
        token.id = user.id as string
        // 這裡要跟 JWT.role 的型別一致（見 types/next-auth.d.ts），不能寫成 string ——
        // 寫寬了 `next build` 的型別檢查會擋下整個 image 建置。值域來自 schema 的 UserRole。
        token.role = (user as { role?: 'CUSTOMER' | 'ADMIN' }).role ?? 'CUSTOMER'
        token.phone = (user as { phone?: string | null }).phone ?? null
        // 語系跟著 token 走，proxy 才能在 NEXT_LOCALE cookie 掉了的時候把它補回來。
        // SSO 登入不經過 authorize()，user 是 PrismaAdapter 直接吐出來的整列，
        // locale 還是未收斂的 string，所以這裡再過一次 toLocale。
        token.locale = toLocale((user as { locale?: string | null }).locale)
      }
      // 會員在 /account 改完資料、或在 header 換語系後呼叫 update()，讓 token 立刻反映新值
      if (trigger === 'update' && session) {
        const patch = session as {
          name?: string
          phone?: string | null
          locale?: 'zh-TW' | 'en' | null
        }
        if (patch.name !== undefined) token.name = patch.name
        if (patch.phone !== undefined) token.phone = patch.phone
        if (patch.locale !== undefined) token.locale = patch.locale
      }
      return token
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.role = (token.role as 'CUSTOMER' | 'ADMIN') ?? 'CUSTOMER'
        session.user.phone = (token.phone as string | null) ?? null
        session.user.locale = (token.locale as 'zh-TW' | 'en' | null) ?? null
      }
      return session
    },
  },

  providers: [],
} satisfies NextAuthConfig
