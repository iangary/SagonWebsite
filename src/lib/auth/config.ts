import type { NextAuthConfig } from 'next-auth'

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
        token.role = (user as { role?: string }).role ?? 'CUSTOMER'
        token.phone = (user as { phone?: string | null }).phone ?? null
      }
      // 會員在 /account 改完資料後呼叫 update()，讓 token 立刻反映新值
      if (trigger === 'update' && session) {
        const patch = session as { name?: string; phone?: string | null }
        if (patch.name !== undefined) token.name = patch.name
        if (patch.phone !== undefined) token.phone = patch.phone
      }
      return token
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.role = (token.role as 'CUSTOMER' | 'ADMIN') ?? 'CUSTOMER'
        session.user.phone = (token.phone as string | null) ?? null
      }
      return session
    },
  },

  providers: [],
} satisfies NextAuthConfig
