import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/routing'
import { env } from '@/lib/env'
import { formatTWD, truncate } from '@/lib/utils'
import {
  breadcrumbJsonLd,
  productJsonLd,
  serializeJsonLd,
} from '@/lib/seo/structured-data'
import { getProductBySlug, getProductReviewStats, getRelatedProducts } from '@/lib/catalog/queries'
import { normalizeDescriptionHtml } from '@/lib/catalog/description'
import { localizedName } from '@/lib/i18n/localized'
import { availableStock } from '@/lib/cart'
import { ProductGallery } from '@/components/product/product-gallery'
import { AddToCart } from '@/components/product/add-to-cart'
import { ProductGrid } from '@/components/product/product-card'
import { ProductDescription } from '@/components/product/product-description'
import { ProductReviews } from '@/components/product/product-reviews'
import { Badge } from '@/components/ui/badge'

/**
 * 刻意不提供 generateStaticParams，也不設 revalidate —— 這頁走動態渲染。
 *
 * 父層 `[locale]` 沒有 generateStaticParams（原因見 [locale]/layout.tsx），
 * 少了語系那一段就拼不出完整路徑，Next 一頁都預渲染不出來，只會把整條路由
 * 登記成「請求時才做靜態產生」（prerender-manifest 的 fallback: blocking）。
 * 而在那條路徑上，未知的 params 本身就算動態存取，每個請求都會拋
 * DYNAMIC_SERVER_USAGE 並回 500 —— 正式站的商品頁與分類頁就是這樣全掛的。
 *
 * 補在 layout 上也救不了：容器建置階段沒有資料庫，generateStaticParams 一樣
 * 回空陣列，繞回同一個 500。
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}): Promise<Metadata> {
  const { locale, slug } = await params
  const product = await getProductBySlug(decodeURIComponent(slug))
  if (!product) return {}

  const name = localizedName(locale, product)
  const description = product.seoDescription ?? truncate(product.summary ?? name, 155)
  const image = product.images[0]?.url

  return {
    title: product.seoTitle ?? name,
    description,
    alternates: { canonical: `/product/${product.slug}` },
    openGraph: {
      type: 'website',
      title: name,
      description,
      images: image ? [{ url: image }] : undefined,
    },
  }
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}) {
  const { locale, slug } = await params
  setRequestLocale(locale)

  const product = await getProductBySlug(decodeURIComponent(slug))
  if (!product) notFound()

  const [t, tNav, tCommon, related, reviewStats] = await Promise.all([
    getTranslations('product'),
    getTranslations('nav'),
    getTranslations('common'),
    getRelatedProducts(product),
    getProductReviewStats(product.id),
  ])

  const name = localizedName(locale, product)

  const variants = product.variants.map((v) => ({
    id: v.id,
    name: v.name,
    price: v.price,
    compareAtPrice: v.compareAtPrice,
    available: availableStock(v),
  }))

  // 來源站帶進來的 HTML 有 4457 個 inline style 會壓過所有 CSS，先正規化掉
  const description = normalizeDescriptionHtml(product.descriptionHtml)

  const onSale = product.compareAtPrice !== null && product.compareAtPrice > product.basePrice

  /*
   * 麵包屑只定義一次，畫面與 BreadcrumbList 結構化資料共用。
   * 分開寫的話改了其中一邊很難發現，而 Google 要求兩者一致。
   */
  const crumbCategory = product.categories[0]?.category
  const breadcrumbTrail = [
    { name: tNav('home'), path: '/' },
    ...(crumbCategory
      ? [
          {
            name: localizedName(locale, crumbCategory),
            path: `/category/${crumbCategory.slug}`,
          },
        ]
      : []),
    { name, path: `/product/${product.slug}` },
  ]

  // Google 購物與搜尋結果需要的結構化資料
  const jsonLd = [
    productJsonLd({
      product: {
        ...product,
        // 每個變體帶自己的 sku 與可售量（Product 本身沒有 sku 欄位）
        variants: product.variants.map((v) => ({
          sku: v.sku,
          price: v.price,
          available: availableStock(v),
        })),
      },
      name,
      description: truncate(product.summary ?? name, 300),
      reviewStats,
    }),
    breadcrumbJsonLd(breadcrumbTrail),
  ]

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />

      <div className="mx-auto max-w-7xl px-6 py-10">
        <Breadcrumbs
          label={tNav('breadcrumb')}
          items={breadcrumbTrail.map((c, i) => ({
            label: c.name,
            // 最後一層是本頁，不給連結
            href: i === breadcrumbTrail.length - 1 ? undefined : c.path,
          }))}
        />

        <div className="mt-8 gap-12 lg:flex">
          <div className="lg:w-[52%]">
            <ProductGallery images={product.images} name={name} />
          </div>

          <div className="mt-10 lg:mt-0 lg:flex-1">
            {product.brand && (
              <Link
                href={`/product/all?brand=${product.brand.slug}`}
                className="text-xs tracking-[0.15em] text-taupe-600 uppercase hover:text-ink-900"
              >
                {product.brand.name}
              </Link>
            )}

            <h1 className="mt-2 text-2xl leading-relaxed">{name}</h1>

            <div className="mt-4 flex items-baseline gap-3">
              <span className={`text-2xl ${onSale ? 'text-sale' : 'text-ink-900'}`}>
                {formatTWD(product.basePrice)}
              </span>
              {onSale && (
                <span className="text-sm text-taupe-400 line-through">
                  {formatTWD(product.compareAtPrice!)}
                </span>
              )}
              {onSale && <Badge tone="sale">{t('sale')}</Badge>}
            </div>

            <hr className="my-7 border-cream-200" />

            <AddToCart variants={variants} />

            <dl className="mt-8 space-y-2 border-t border-cream-200 pt-6 text-xs text-taupe-600">
              <div>
                <dt className="inline">
                  {t('shippingLabel')}
                  {tCommon('colon')}
                </dt>
                <dd className="inline">{t('shippingValue')}</dd>
              </div>
              <div>
                <dt className="inline">
                  {t('paymentLabel')}
                  {tCommon('colon')}
                </dt>
                <dd className="inline">{t('paymentValue')}</dd>
              </div>
              <div>
                <dt className="inline">
                  {t('freeShippingLabel')}
                  {tCommon('colon')}
                </dt>
                <dd className="inline">
                  {t('freeShippingValue', { amount: formatTWD(env.FREE_SHIPPING_THRESHOLD) })}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        {description && (
          <section className="mt-20 border-t border-cream-200 pt-10">
            {/* 這一段刻意置中成一個編輯式區塊；下面的評論與相關商品維持左對齊 */}
            <div className="mx-auto max-w-[42.5rem]">
              <h2 className="text-center text-lg tracking-[0.12em]">{t('description')}</h2>
              <div className="mt-8">
                <ProductDescription
                  html={description}
                  labels={{
                    expand: t('expandDescription'),
                    collapse: t('collapseDescription'),
                  }}
                />
              </div>
            </div>
          </section>
        )}

        <ProductReviews
          productId={product.id}
          reviews={product.reviews}
          average={reviewStats.average}
          total={reviewStats.total}
          labels={{ title: t('reviews'), empty: t('noReviews') }}
        />

        {related.length > 0 && (
          <section className="mt-20 border-t border-cream-200 pt-10">
            <h2 className="text-lg tracking-[0.12em]">{t('relatedProducts')}</h2>
            <div className="mt-8">
              <ProductGrid products={related} priorityCount={0} />
            </div>
          </section>
        )}
      </div>
    </>
  )
}

function Breadcrumbs({
  label,
  items,
}: {
  label: string
  items: { label: string; href?: string }[]
}) {
  return (
    <nav aria-label={label}>
      <ol className="flex flex-wrap items-center gap-1.5 text-xs text-taupe-500">
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden>/</span>}
            {item.href ? (
              <Link href={item.href} className="hover:text-ink-900">
                {item.label}
              </Link>
            ) : (
              <span className="line-clamp-1 text-ink-700">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
