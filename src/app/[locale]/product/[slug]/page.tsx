import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/routing'
import { env } from '@/lib/env'
import { formatTWD, truncate } from '@/lib/utils'
import { getProductBySlug, getRelatedProducts } from '@/lib/catalog/queries'
import { localizedName } from '@/lib/i18n/localized'
import { availableStock } from '@/lib/cart'
import { ProductGallery } from '@/components/product/product-gallery'
import { AddToCart } from '@/components/product/add-to-cart'
import { ProductGrid } from '@/components/product/product-card'
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

  const [t, tNav, tCommon, related] = await Promise.all([
    getTranslations('product'),
    getTranslations('nav'),
    getTranslations('common'),
    getRelatedProducts(product),
  ])

  const name = localizedName(locale, product)

  const variants = product.variants.map((v) => ({
    id: v.id,
    name: v.name,
    price: v.price,
    compareAtPrice: v.compareAtPrice,
    available: availableStock(v),
  }))

  const onSale = product.compareAtPrice !== null && product.compareAtPrice > product.basePrice
  const inStock = variants.some((v) => v.available > 0)

  // Google 購物與搜尋結果需要的結構化資料
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    description: truncate(product.summary ?? name, 300),
    image: product.images.map((i) => new URL(i.url, env.APP_URL).toString()),
    brand: product.brand ? { '@type': 'Brand', name: product.brand.name } : undefined,
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: 'TWD',
      lowPrice: Math.min(...variants.map((v) => v.price)),
      highPrice: Math.max(...variants.map((v) => v.price)),
      offerCount: variants.length,
      availability: inStock
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
    },
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="mx-auto max-w-7xl px-6 py-10">
        <Breadcrumbs
          label={tNav('breadcrumb')}
          items={[
            { label: tNav('home'), href: '/' },
            ...product.categories.slice(0, 1).map((c) => ({
              label: localizedName(locale, c.category),
              href: `/category/${c.category.slug}`,
            })),
            { label: name },
          ]}
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

        {product.descriptionHtml && (
          <section className="mt-20 border-t border-cream-200 pt-10">
            <h2 className="text-lg tracking-[0.12em]">{t('description')}</h2>
            <div
              className="prose-product mt-6 max-w-3xl text-sm text-ink-700"
              // 商品描述是從來源站帶進來的 HTML。正式營運時這段應改由後台的
              // 富文字編輯器產生，並在寫入時做 sanitize。
              dangerouslySetInnerHTML={{ __html: product.descriptionHtml }}
            />
          </section>
        )}

        <ProductReviews
          productId={product.id}
          reviews={product.reviews}
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
