import { db } from '@/lib/db'
import { availableStock } from '@/lib/cart'
import { shopConfig } from '@/lib/shop-config'
import { buildProductFeed, type FeedProduct } from '@/lib/seo/product-feed'

/**
 * Google Merchant Center 與 Meta 目錄用的商品 feed。
 *
 * 在 Merchant Center 設定每日排程抓取這個網址之後，價格與庫存就永遠
 * 自動同步，不用再手動上傳試算表。
 *
 * 跟 sitemap.ts 一樣走 force-dynamic —— 容器建置階段沒有資料庫。
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  const products = await db.product.findMany({
    where: {
      status: 'ACTIVE',
      // 沒有可售變體的商品送進去只會被 Merchant Center 退件
      variants: { some: { isActive: true } },
    },
    select: {
      id: true,
      slug: true,
      name: true,
      summary: true,
      basePrice: true,
      images: { select: { url: true }, orderBy: { sortOrder: 'asc' } },
      brand: { select: { name: true } },
      variants: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: {
          sku: true,
          name: true,
          options: true,
          price: true,
          compareAtPrice: true,
          stock: true,
          reservedStock: true,
        },
      },
    },
  })

  const feedProducts: FeedProduct[] = products.map((p) => ({
    ...p,
    variants: p.variants.map((v) => ({
      sku: v.sku,
      name: v.name,
      options: v.options,
      price: v.price,
      compareAtPrice: v.compareAtPrice,
      available: availableStock(v),
    })),
  }))

  const xml = buildProductFeed(feedProducts, shopConfig.name)

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      // Merchant Center 一天只抓一次，但別讓中間層快取太久蓋掉庫存變化
      'Cache-Control': 'public, max-age=0, s-maxage=3600',
    },
  })
}
