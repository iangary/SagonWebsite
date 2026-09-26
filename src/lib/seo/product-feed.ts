import 'server-only'
import { shopConfig } from '@/lib/shop-config'
import { absoluteUrl, siteUrl } from '@/lib/seo/structured-data'

/**
 * Google Merchant Center／Meta 目錄的商品 feed（RSS 2.0 + g: 命名空間）。
 *
 * 一個變體一筆 item，用 `g:item_group_id` 把同商品的不同顏色尺寸綁在一起 ——
 * 服飾寢具類必須這樣做，否則 Google 會把「米白 M」和「米白 L」當成兩個
 * 不相干的商品，比價與再行銷都會亂掉。
 *
 * 為什麼放在 /feeds/ 而不是 /api/：`app/robots.ts` 把整個 `/api/` 設成
 * Disallow，feed 擺進去會被自己的 robots.txt 擋掉。
 */

export type FeedVariant = {
  sku: string
  name: string
  options: unknown
  price: number
  compareAtPrice: number | null
  available: number
}

export type FeedProduct = {
  /** cuid。當 g:item_group_id 用 —— 見 itemXml 裡的說明 */
  id: string
  slug: string
  name: string
  summary: string | null
  basePrice: number
  images: { url: string }[]
  brand: { name: string } | null
  variants: FeedVariant[]
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** Google 的欄位長度上限：標題 150、描述 5000 */
function clamp(value: string, max: number): string {
  const trimmed = value.trim().replace(/\s+/g, ' ')
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max - 1).trimEnd() + '…'
}

function tag(name: string, value: string | number): string {
  return `<${name}>${escapeXml(String(value))}</${name}>`
}

/**
 * 從變體的 options JSON 取顏色與尺寸。
 *
 * options 長這樣：{ "顏色": "米白", "尺寸": "M" }。Google 的 g:color / g:size
 * 是服飾類變體的建議欄位，有填的話同組商品在購物版位才會併成一張卡片。
 */
function variantAttributes(options: unknown): { color?: string; size?: string } {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return {}
  const record = options as Record<string, unknown>

  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = record[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
    return undefined
  }

  return {
    color: pick('顏色', '色系', 'color', 'Color'),
    size: pick('尺寸', '尺碼', 'size', 'Size'),
  }
}

function itemXml(product: FeedProduct, variant: FeedVariant): string {
  const link = absoluteUrl(`/product/${product.slug}`)
  const [cover, ...rest] = product.images

  /*
   * compareAtPrice 是「原價」。有原價而且高於售價時，Google 要的是
   * g:price = 原價、g:sale_price = 現售價 —— 反過來填會讓折扣顯示不出來。
   */
  const onSale = variant.compareAtPrice !== null && variant.compareAtPrice > variant.price
  const listPrice = onSale ? variant.compareAtPrice! : variant.price

  const { color, size } = variantAttributes(variant.options)

  const parts = [
    tag('g:id', variant.sku),
    /*
     * 同商品的變體共用一個 group id。
     *
     * 用 cuid 而不是 slug —— 這個站的 slug 含中文（例如
     * `the-warmth-法式朱依紋圍裙-柔霧粉-2643530`），而 Google 的規格要求
     * item_group_id 只用英數字元。cuid 本來就是英數、穩定且唯一。
     */
    tag('g:item_group_id', product.id),
    tag('title', clamp(`${product.name} ${variant.name}`, 150)),
    tag('description', clamp(product.summary ?? product.name, 5000)),
    tag('link', link),
    ...(cover ? [tag('g:image_link', absoluteUrl(cover.url))] : []),
    // Google 最多收 10 張附圖
    ...rest.slice(0, 10).map((i) => tag('g:additional_image_link', absoluteUrl(i.url))),
    tag('g:availability', variant.available > 0 ? 'in_stock' : 'out_of_stock'),
    tag('g:condition', 'new'),
    tag('g:price', `${listPrice} TWD`),
    ...(onSale ? [tag('g:sale_price', `${variant.price} TWD`)] : []),
    ...(product.brand ? [tag('g:brand', product.brand.name)] : []),
    /*
     * 沒有 GTIN／MPN 時必須明講 identifier_exists=no。
     * 少了這行，Merchant Center 會判定「缺少商品識別碼」而把整批商品退掉。
     */
    tag('g:identifier_exists', 'no'),
    ...(color ? [tag('g:color', color)] : []),
    ...(size ? [tag('g:size', size)] : []),
    `<g:shipping>${tag('g:country', 'TW')}${tag('g:price', `${shopConfig.shippingFee.HOME} TWD`)}</g:shipping>`,
  ]

  return `<item>${parts.join('')}</item>`
}

export function buildProductFeed(products: FeedProduct[], shopTitle: string): string {
  const items = products
    .flatMap((p) => p.variants.map((v) => itemXml(p, v)))
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
${tag('title', shopTitle)}
${tag('link', siteUrl())}
${tag('description', `${shopTitle} 商品目錄`)}
${items}
</channel>
</rss>`
}
