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
        // 手機驗證碼第一次登入（還沒有密碼）時為 true。SSO 走 PrismaAdapter，
        // user 上沒有這個欄位 → undefined → 不擋（他們本來就有免費的登入方式）。
        token.needsPassword = (user as { needsPassword?: boolean }).needsPassword ?? false
        // 剛從資料庫讀出來的 role 當然是新的，蓋上時間戳讓 index.ts 那段節流不用馬上再查一次
        token.roleCheckedAt = Date.now()
      }
      // 會員在 /account 改完資料、或在 header 換語系後呼叫 update()，讓 token 立刻反映新值
      if (trigger === 'update' && session) {
        // client 的 update(data) 直接給物件；server 的 unstable_update()
        // 包成 { user: {...} }，兩種都要收。
        const patch = session as {
          name?: string
          phone?: string | null
          locale?: 'zh-TW' | 'en' | 'ja' | 'ko' | 'fr' | null
          needsPassword?: boolean
          user?: { needsPassword?: boolean }
        }
        if (patch.name !== undefined) token.name = patch.name
        if (patch.phone !== undefined) token.phone = patch.phone
        if (patch.locale !== undefined) token.locale = patch.locale
        // 設完密碼後前端呼叫 update({ needsPassword: false }) 解鎖，
        // 否則 proxy 會拿著舊 token 一直把他導回設定頁。
        const needsPassword = patch.needsPassword ?? patch.user?.needsPassword
        if (needsPassword !== undefined) token.needsPassword = needsPassword
      }
      return token
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.role = (token.role as 'CUSTOMER' | 'ADMIN') ?? 'CUSTOMER'
        session.user.phone = (token.phone as string | null) ?? null
        session.user.locale = (token.locale as 'zh-TW' | 'en' | 'ja' | 'ko' | 'fr' | null) ?? null
        session.user.needsPassword = token.needsPassword === true
      }
      return session
    },
  },

  providers: [],
} satisfies NextAuthConfig
