import Image from 'next/image'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { ArrowRight } from 'lucide-react'
import { Link } from '@/i18n/routing'
import { Button } from '@/components/ui/button'
import { ProductGrid } from '@/components/product/product-card'
import { getFeaturedProducts, getHeroBanner, listBrands, listProducts } from '@/lib/catalog/queries'

// 商品資料變動不頻繁，用 ISR 讓首頁走 CDN 快取
export const revalidate = 300

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  const [t, hero, featured, brands, newest] = await Promise.all([
    getTranslations('home'),
    getHeroBanner(),
    getFeaturedProducts(8),
    listBrands(),
    listProducts({ sort: 'newest', page: 1 }),
  ])

  return (
    <>
      {/* Hero */}
      <section className="relative flex min-h-[62vh] items-center overflow-hidden bg-cream-100 sm:min-h-[72vh]">
        {hero && (
          <Image
            src={hero.imageUrl}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover object-center"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-cream-50/90 via-cream-50/60 to-transparent" />

        <div className="relative mx-auto w-full max-w-7xl px-6">
          <div className="max-w-lg">
            <p className="text-xs tracking-[0.35em] text-taupe-600 uppercase">Sagan Select</p>
            <h1 className="mt-5 text-3xl leading-[1.4] text-ink-900 sm:text-4xl sm:leading-[1.4]">
              {hero?.title ?? t('heroTitle')}
            </h1>
            <p className="mt-4 text-sm leading-relaxed text-ink-700 sm:text-base">
              {hero?.subtitle ?? t('heroSubtitle')}
            </p>
            <Button asChild size="lg" className="mt-9">
              <Link href={hero?.linkUrl ?? '/product/all'}>
                {t('heroCta')}
                <ArrowRight size={16} />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* 品牌 */}
      <section className="mx-auto max-w-7xl px-6 py-16 sm:py-20">
        <SectionHeading title={t('shopByBrand')} />
        <div className="no-scrollbar -mx-6 mt-8 flex gap-3 overflow-x-auto px-6 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0 lg:grid-cols-4">
          {brands.map((brand) => (
            <Link
              key={brand.slug}
              href={`/product/all?brand=${brand.slug}`}
              className="group flex min-w-40 shrink-0 flex-col justify-between border border-cream-200 bg-white p-5 transition-colors hover:border-taupe-400 sm:min-w-0"
            >
              <span className="text-sm tracking-[0.1em] text-ink-900">{brand.name}</span>
              <span className="mt-6 text-xs text-taupe-500">
                {brand._count.products} 件商品
                <ArrowRight
                  size={13}
                  className="ml-1 inline transition-transform group-hover:translate-x-0.5"
                />
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* 精選 */}
      <section className="mx-auto max-w-7xl px-6 pb-16 sm:pb-20">
        <SectionHeading title={t('featured')} href="/product/all" linkLabel={t('viewAll')} />
        <div className="mt-8">
          <ProductGrid products={featured} />
        </div>
      </section>

      {/* 品牌敘事 */}
      <section className="bg-cream-100 py-20">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <p className="text-xs tracking-[0.3em] text-taupe-600 uppercase">About</p>
          <h2 className="mt-5 text-2xl leading-relaxed">經典、優雅、質感</h2>
          <p className="mt-5 text-sm leading-loose text-ink-700">
            莎岡選品店創立於 2023 年春天，專注引進韓國高品質睡衣、寢具與家居飾品。
            我們嚴選韓國品牌，並與品牌總部正式授權合作，
            希望每一件送到您手中的商品，都能陪伴日常裡那些最放鬆的時刻。
          </p>
          <Button asChild variant="outline" className="mt-8">
            <Link href="/about">認識莎岡</Link>
          </Button>
        </div>
      </section>

      {/* 新品 */}
      <section className="mx-auto max-w-7xl px-6 py-16 sm:py-20">
        <SectionHeading title={t('newArrivals')} href="/product/all" linkLabel={t('viewAll')} />
        <div className="mt-8">
          <ProductGrid products={newest.items.slice(0, 8)} priorityCount={0} />
        </div>
      </section>
    </>
  )
}

function SectionHeading({
  title,
  href,
  linkLabel,
}: {
  title: string
  href?: string
  linkLabel?: string
}) {
  return (
    <div className="flex items-end justify-between border-b border-cream-200 pb-4">
      <h2 className="text-xl tracking-[0.12em] sm:text-2xl">{title}</h2>
      {href && linkLabel && (
        <Link
          href={href}
          className="flex items-center gap-1 text-xs tracking-wide text-taupe-600 transition-colors hover:text-ink-900"
        >
          {linkLabel}
          <ArrowRight size={13} />
        </Link>
      )}
    </div>
  )
}
