import type { MetadataRoute } from 'next'
import { db } from '@/lib/db'
import { env } from '@/lib/env'

// 建置階段沒有資料庫（Docker 多階段建置），改成每次請求時產生。
// 商品會上下架，sitemap 本來就該反映當下狀態。
export const dynamic = 'force-dynamic'

/**
 * 只列一組網址，不做語系 alternates。
 *
 * localePrefix 是 never（見 i18n/routing.ts）：兩個語系共用同一組網址、
 * 靠 NEXT_LOCALE cookie 區分，所以沒有「英文版的網址」可以指。
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env.APP_URL.replace(/\/$/, '')

  const entry = (
    path: string,
    changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'],
    priority: number,
    lastModified?: Date,
  ): MetadataRoute.Sitemap[number] => ({
    url: `${base}${path}`,
    lastModified,
    changeFrequency,
    priority,
  })

  const staticPages: MetadataRoute.Sitemap = [
    entry('/', 'daily', 1),
    entry('/product/all', 'daily', 0.9),
    entry('/about', 'monthly', 0.5),
    entry('/faq', 'monthly', 0.5),
    entry('/contact', 'monthly', 0.4),
    entry('/order/query', 'yearly', 0.3),
    entry('/returns', 'yearly', 0.3),
    entry('/terms', 'yearly', 0.2),
    entry('/privacy', 'yearly', 0.2),
  ]

  const [categories, products] = await Promise.all([
    db.category.findMany({ select: { slug: true } }),
    db.product.findMany({
      where: { status: 'ACTIVE' },
      select: { slug: true, updatedAt: true },
    }),
  ])

  return [
    ...staticPages,
    ...categories.map((c) => entry(`/category/${c.slug}`, 'weekly', 0.7)),
    ...products.map((p) => entry(`/product/${p.slug}`, 'weekly', 0.8, p.updatedAt)),
  ]
}
