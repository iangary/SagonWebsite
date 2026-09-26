import Image from 'next/image'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { ArrowRight } from 'lucide-react'
import { Link } from '@/i18n/routing'
import { defaultLocale } from '@/i18n/config'
import { Button } from '@/components/ui/button'
import { Reveal } from '@/components/ui/reveal'
import { BrandMarquee } from '@/components/layout/brand-marquee'
import { ScrollRail } from '@/components/home/scroll-rail'
import { HeroVisual } from '@/components/hero/hero-visual'
import { ProductGrid } from '@/components/product/product-card'
import {
  getFeaturedProducts,
  getHeroBanner,
  listBrandShowcase,
  listProducts,
} from '@/lib/catalog/queries'
import { shopName } from '@/lib/shop-config'
import { cn } from '@/lib/utils'

// 商品資料變動不頻繁，用 ISR 讓首頁走 CDN 快取
export const revalidate = 300

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  const [t, hero, featured, brands, newest] = await Promise.all([
    getTranslations('home'),
    getHeroBanner(),
    getFeaturedProducts(8),
    listBrandShowcase(),
    listProducts({ sort: 'newest', page: 1 }),
  ])

  const shop = shopName(locale)

  // Banner 的文案挑當前語系的欄位，沒填就退回 messages 的預設標語 ——
  // 刻意不退回 hero.title，那欄一定是中文，英文站會整段變中文。
  const isDefaultLocale = locale === defaultLocale
  const heroTitle = (isDefaultLocale ? hero?.title : hero?.titleEn?.trim()) || t('heroTitle')
  const heroSubtitle =
    (isDefaultLocale ? hero?.subtitle : hero?.subtitleEn?.trim()) || t('heroSubtitle')

  return (
    <>
      {/*
        Hero：左文右圖的對半版型。
        照片完全不加霧化，讓商品本身說話；絲綢動態層只鋪在文字那一側當底紋。
        手機上照片在上、文字在下（DOM 仍是文字在前，h1 先被讀到）。
      */}
      <section className="grid bg-cream-100 lg:min-h-[min(80vh,760px)] lg:grid-cols-2">
        <div
          className={cn(
            'relative flex items-center overflow-hidden px-6 py-10 sm:py-20 lg:py-24 lg:pr-16',
            // 文字的左緣對齊下方 max-w-7xl 內容區的左緣（80rem 容器 + 1.5rem 內距）
            'lg:pl-[max(1.5rem,calc((100vw-80rem)/2+1.5rem))]',
            hero ? '' : 'lg:col-span-2',
          )}
        >
          <HeroVisual />
          <div className="relative max-w-xl">
            <p className="fade-up flex items-center gap-4 [animation-delay:150ms]">
              <span aria-hidden className="h-px w-10 bg-plum-600" />
              <span className="font-display text-lg tracking-[0.12em] text-taupe-600 italic">
                Sagan Boutique
              </span>
            </p>
            <h1 className="fade-up mt-7 text-4xl leading-[1.35] tracking-[0.04em] text-balance text-ink-900 [animation-delay:300ms] sm:text-5xl sm:leading-[1.3] xl:text-6xl xl:leading-[1.25]">
              <BreakableTitle text={heroTitle} />
            </h1>
            <p className="fade-up mt-6 max-w-sm text-sm leading-relaxed tracking-wide text-ink-700 [animation-delay:450ms] sm:text-base">
              {heroSubtitle}
            </p>
            <div className="fade-up [animation-delay:600ms]">
              <Button asChild size="lg" className="group mt-10 hover:tracking-[0.12em]">
                <Link href={hero?.linkUrl ?? '/product/all'}>
                  {t('heroCta')}
                  <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
                </Link>
              </Button>
            </div>
          </div>
        </div>

        {hero && (
          <div className="relative order-first h-[46vh] min-h-72 lg:order-none lg:h-auto">
            <Image
              src={hero.imageUrl}
              alt=""
              fill
              priority
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="object-cover object-center"
            />
          </div>
        )}
      </section>

      {/* 品牌跑馬燈 */}
      <BrandMarquee items={brands.map((brand) => brand.name)} />

      {/* 品牌櫥窗：直式情境照 + 品牌名，橫向滑動 */}
      <section className="mx-auto max-w-7xl px-6 py-16 sm:py-24">
        <Reveal>
          <SectionHeading title={t('shopByBrand')} />
        </Reveal>
        <ScrollRail
          labels={{ prev: t('brandPrev'), next: t('brandNext') }}
          className="-mx-6 mt-10 scroll-px-6 gap-4 px-6 sm:mx-0 sm:scroll-px-0 sm:px-0"
        >
          {brands.map((brand) => (
            <Link
              key={brand.slug}
              href={`/product/all?brand=${brand.slug}`}
              className="group relative block w-[64vw] shrink-0 snap-start overflow-hidden bg-cream-200 sm:w-[calc((100%-2rem)/3)] lg:w-[calc((100%-3rem)/4)]"
            >
              <div className="relative aspect-[4/5]">
                {brand.coverUrl && (
                  <Image
                    src={brand.coverUrl}
                    alt=""
                    fill
                    sizes="(min-width: 1024px) 20rem, (min-width: 640px) 33vw, 64vw"
                    className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-ink-900/65 via-ink-900/10 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-5 text-cream-50">
                  <span className="block font-display text-2xl leading-tight tracking-[0.1em] sm:text-[1.7rem]">
                    {brand.name}
                  </span>
                  <span className="mt-2 flex items-center gap-1.5 text-xs tracking-wide text-cream-100/90">
                    {t('brandProductCount', { count: brand._count.products })}
                    <ArrowRight
                      size={13}
                      className="transition-transform group-hover:translate-x-1"
                    />
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </ScrollRail>
      </section>

      {/* 精選 */}
      <section className="mx-auto max-w-7xl px-6 pb-16 sm:pb-20">
        <Reveal>
          <SectionHeading title={t('featured')} href="/product/all" linkLabel={t('viewAll')} />
        </Reveal>
        <div className="mt-8">
          <ProductGrid products={featured} />
        </div>
      </section>

      {/* 品牌敘事 */}
      <section className="bg-cream-100 py-20">
        <Reveal className="mx-auto max-w-2xl px-6 text-center">
          <p className="text-xs tracking-[0.3em] text-taupe-600 uppercase">About</p>
          <h2 className="mt-5 text-3xl leading-relaxed tracking-[0.08em]">{t('aboutTitle')}</h2>
          <p className="mt-5 text-sm leading-loose text-ink-700">{t('aboutBody', { shop })}</p>
          <Button asChild variant="outline" className="mt-8">
            <Link href="/about">{t('aboutCta', { shop })}</Link>
          </Button>
        </Reveal>
      </section>

      {/* 新品 */}
      <section className="mx-auto max-w-7xl px-6 py-16 sm:py-20">
        <Reveal>
          <SectionHeading title={t('newArrivals')} href="/product/all" linkLabel={t('viewAll')} />
        </Reveal>
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
      <h2 className="text-2xl tracking-[0.12em] sm:text-3xl">{title}</h2>
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

/**
 * 中文標題只在標點後面換行。
 *
 * 瀏覽器預設可以在任兩個漢字之間斷行，標題一窄就會把最後一個字孤零零擠到下一行
 * （「…道德／觀」）。把標題在全形標點後切段、每段 inline-block，換行只會落在段與段之間；
 * 單段比容器還寬時 inline-block 會在自己內部換行，不會撐破版面。
 * 英文標題沒有全形標點，整段原樣輸出，交給 h1 上的 text-balance。
 */
function BreakableTitle({ text }: { text: string }) {
  const segments = text.split(/(?<=[，、。！？；：])/)
  if (segments.length < 2) return text
  return segments.map((segment, i) => (
    <span key={i} className="inline-block">
      {segment}
    </span>
  ))
}
