import 'server-only'
import { db } from '@/lib/db'
import { formatTWD } from '@/lib/utils'
import { localizedName } from '@/lib/i18n/localized'
import { PRODUCT_CARD_SELECT, isPurchasable, type ProductCardData } from '@/lib/catalog/queries'
import { escapeHtml, extractProductSlugs, sanitizePostHtml } from './html'

export type ProductEmbedLabels = { view: string; soldOut: string }

/**
 * 文章內文 → 可以直接 dangerouslySetInnerHTML 的 HTML。
 *
 * `{{product:slug}}` 換成商品卡片：一次查回所有用到的商品，只收上架中的。
 * 找不到或已下架的短碼直接消失 —— 文章是長期留在站上的，
 * 不該因為某件商品賣完下架就在文章裡留一段看不懂的 `{{product:…}}`。
 */
export async function renderPostBody(
  html: string,
  locale: string,
  labels: ProductEmbedLabels,
): Promise<string> {
  const slugs = extractProductSlugs(html)
  const products =
    slugs.length > 0
      ? await db.product.findMany({
          where: { slug: { in: slugs }, status: 'ACTIVE' },
          select: PRODUCT_CARD_SELECT,
        })
      : []
  const bySlug = new Map(products.map((p) => [p.slug, p]))

  return sanitizePostHtml(html, (slug) => {
    const product = bySlug.get(slug)
    return product ? productCardHtml(product, locale, labels) : null
  })
}

/**
 * 商品卡片的 HTML。全部用行內元素（a / img / span）組成，
 * 放在 <p> 裡也不會被瀏覽器拆段；排版交給 globals.css 的 .journal-product。
 * 每一個來自資料庫的值都經過 escapeHtml。
 */
export function productCardHtml(
  product: ProductCardData,
  locale: string,
  labels: ProductEmbedLabels,
): string {
  const name = localizedName(locale, product)
  const image = product.images[0]
  const onSale = product.compareAtPrice !== null && product.compareAtPrice > product.basePrice
  const href = `/product/${encodeURIComponent(product.slug)}`

  const img = image
    ? `<img class="journal-product__image" src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt ?? name)}" loading="lazy">`
    : '<span class="journal-product__image" aria-hidden="true"></span>'

  const price = onSale
    ? `<span class="journal-product__price is-sale">${formatTWD(product.basePrice)}</span>` +
      `<s class="journal-product__compare">${formatTWD(product.compareAtPrice!)}</s>`
    : `<span class="journal-product__price">${formatTWD(product.basePrice)}</span>`

  const status = isPurchasable(product)
    ? `<span class="journal-product__cta">${escapeHtml(labels.view)} →</span>`
    : `<span class="journal-product__cta is-muted">${escapeHtml(labels.soldOut)}</span>`

  return (
    `<a class="journal-product" href="${escapeHtml(href)}">` +
    img +
    '<span class="journal-product__body">' +
    (product.brand ? `<span class="journal-product__brand">${escapeHtml(product.brand.name)}</span>` : '') +
    `<span class="journal-product__name">${escapeHtml(name)}</span>` +
    `<span class="journal-product__prices">${price}</span>` +
    status +
    '</span></a>'
  )
}
