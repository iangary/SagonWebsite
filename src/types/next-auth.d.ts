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
      /** 手機驗證碼登入進來、但帳號還沒有密碼 —— proxy 會把他擋在設定密碼頁 */
      needsPassword: boolean
    } & DefaultSession['user']
  }

  interface User {
    role?: 'CUSTOMER' | 'ADMIN'
    phone?: string | null
    locale?: 'zh-TW' | 'en' | null
    needsPassword?: boolean
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string
    role?: 'CUSTOMER' | 'ADMIN'
    phone?: string | null
    locale?: 'zh-TW' | 'en' | null
    /** proxy 只讀 JWT（不碰 DB），所以這個旗標必須跟著 token 走 */
    needsPassword?: boolean
  }
}

export {}
