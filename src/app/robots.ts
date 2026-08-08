import type { MetadataRoute } from 'next'
import { env } from '@/lib/env'

// 與 sitemap 一樣：建置階段拿不到環境變數，改成請求時產生
export const dynamic = 'force-dynamic'

export default function robots(): MetadataRoute.Robots {
  const base = env.APP_URL.replace(/\/$/, '')

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // 會員與結帳流程沒有被索引的價值，而且含有個人資料
        disallow: ['/api/', '/admin/', '/account/', '/cart', '/checkout', '/order/', '/login', '/register'],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  }
}
