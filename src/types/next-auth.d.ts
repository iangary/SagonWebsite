import type { DefaultSession } from 'next-auth'

// role 與 locale 都刻意寫成字面量聯集而不是 string，也不從 @prisma/client 或
// @/i18n/config import —— 這個 ambient 檔會被 edge 與 client 一起吃到，不該拉進那些模組。
// 寫寬了 authConfig 尾端的 `satisfies NextAuthConfig` 會在 next build 擋下整個 image 建置。
declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      role: 'CUSTOMER' | 'ADMIN'
      phone: string | null
      locale: 'zh-TW' | 'en' | null
    } & DefaultSession['user']
  }

  interface User {
    role?: 'CUSTOMER' | 'ADMIN'
    phone?: string | null
    locale?: 'zh-TW' | 'en' | null
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string
    role?: 'CUSTOMER' | 'ADMIN'
    phone?: string | null
    locale?: 'zh-TW' | 'en' | null
  }
}

export {}
