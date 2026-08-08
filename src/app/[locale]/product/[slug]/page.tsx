import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/routing'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { formatTWD, truncate } from '@/lib/utils'
import { getProductBySlug, getRelatedProducts } from '@/lib/catalog/queries'
import { availableStock } from '@/lib/cart'
import { ProductGallery } from '@/components/product/product-gallery'
import { AddToCart } from '@/components/product/add-to-cart'
import { ProductGrid } from '@/components/product/product-card'
import { ProductReviews } from '@/components/product/product-reviews'
import { Badge } from '@/components/ui/badge'

export const revalidate = 300

export async function generateStaticParams() {
  // 在容器裡建置時連不到資料庫，這時回空陣列讓所有商品頁改成第一次被請求時
  // 才渲染，之後照 revalidate 快取。有資料庫的話就照舊預先產生。
  try {
    const products = await db.product.findMany({
      where: { status: 'ACTIVE' },
      select: { slug: true },
    })
    return products.map((p) => ({ slug: p.slug }))
  } catch {
    return []
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const product = await getProductBySlug(decodeURIComponent(slug))
  if (!product) return {}

  const description = product.seoDescription ?? truncate(product.summary ?? product.name, 155)
  const image = product.images[0]?.url

  return {
    title: product.seoTitle ?? product.name,
    description,
    alternates: { canonical: `/product/${product.slug}` },
    openGraph: {
      type: 'website',
      title: product.name,
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

  const [t, related] = await Promise.all([
    getTranslations('product'),
    getRelatedProducts(product),
  ])

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
    name: product.name,
    description: truncate(product.summary ?? product.name, 300),
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
          items={[
            { label: '首頁', href: '/' },
            ...product.categories.slice(0, 1).map((c) => ({
              label: c.category.name,
              href: `/category/${c.category.slug}`,
            })),
            { label: product.name },
          ]}
        />

        <div className="mt-8 gap-12 lg:flex">
          <div className="lg:w-[52%]">
            <ProductGallery images={product.images} name={product.name} />
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

            <h1 className="mt-2 text-2xl leading-relaxed">{product.name}</h1>

            <div className="mt-4 flex items-baseline gap-3">
              <span className={`text-2xl ${onSale ? 'text-sale' : 'text-ink-900'}`}>
                {formatTWD(product.basePrice)}
              </span>
              {onSale && (
                <span className="text-sm text-taupe-400 line-through">
                  {formatTWD(product.compareAtPrice!)}
                </span>
              )}
              {onSale && <Badge tone="sale">特價</Badge>}
            </div>

            <hr className="my-7 border-cream-200" />

            <AddToCart
              variants={variants}
              labels={{
                selectVariant: t('selectVariant'),
                quantity: t('quantity'),
                addToCart: t('addToCart'),
                buyNow: t('buyNow'),
                outOfStock: t('outOfStock'),
                lowStock: t('lowStock', { count: 0 }).replace('0', '{count}'),
                addedToCart: t('addedToCart'),
              }}
            />

            <dl className="mt-8 space-y-2 border-t border-cream-200 pt-6 text-xs text-taupe-600">
              <div>
                <dt className="inline">配送方式：</dt>
                <dd className="inline">超商取貨（7-11／全家／萊爾富／OK）、宅配到府</dd>
              </div>
              <div>
                <dt className="inline">付款方式：</dt>
                <dd className="inline">信用卡、ATM 虛擬帳號、超商代碼繳費</dd>
              </div>
              <div>
                <dt className="inline">免運門檻：</dt>
                <dd className="inline">消費滿 {formatTWD(env.FREE_SHIPPING_THRESHOLD)}</dd>
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

function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="麵包屑">
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
