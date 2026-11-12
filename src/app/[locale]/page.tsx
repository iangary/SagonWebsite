import type * as React from 'react'
import Image from 'next/image'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { ArrowRight, Ruler } from 'lucide-react'
import { Link } from '@/i18n/routing'
import { defaultLocale } from '@/i18n/config'
import { Button } from '@/components/ui/button'
import { Reveal } from '@/components/ui/reveal'
import { BrandMarquee } from '@/components/layout/brand-marquee'
import { ScrollRail } from '@/components/home/scroll-rail'
import { HeroCarousel } from '@/components/home/hero-carousel'
import { ProductRecommender } from '@/components/home/product-recommender'
import { ZoomableImage } from '@/components/ui/zoomable-image'
import { ProductGrid } from '@/components/product/product-card'
import {
  getFeaturedProducts,
  getHeroBanner,
  listBrandShowcase,
  listProducts,
} from '@/lib/catalog/queries'
import { hasFitData } from '@/lib/recommend/candidates'
import { lineSupport, shopName } from '@/lib/shop-config'
import { cn } from '@/lib/utils'
import storefrontImg from '@/assets/hero/storefront.jpg'
import portraitImg from '@/assets/hero/sagan-portrait.jpg'
import lineQrImg from '@/assets/hero/line-qr.png'
import giftImg from '@/assets/hero/gift.png'
import certificateImg from '@/assets/hero/lunaluz-certificate.jpg'
import kraftTileImg from '@/assets/hero/kraft-tile.jpg'

// 商品資料變動不頻繁，用 ISR 讓首頁走 CDN 快取
export const revalidate = 300

// 牛皮紙底：從插畫本身上下的空白紙裁出來、交叉淡入接成的無縫紋理（不是鏡像，才不會出現萬花筒圖樣），
// 平均色與插畫的紙一致。background-size 對齊插畫在畫面上的縮放比例，紙紋粗細才接得上：
// 手機插畫約 48vh 高 → 0.145 倍；lg 約 720px 高 → 0.27 倍（tile 原始 2160×760）。
const PAPER = {
  backgroundColor: '#a5886b',
  backgroundImage: `url(${kraftTileImg.src})`,
} as const

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  const [t, hero, featured, brands, newest, showSizePick] = await Promise.all([
    getTranslations('home'),
    getHeroBanner(),
    getFeaturedProducts(8),
    listBrandShowcase(),
    listProducts({ sort: 'newest', page: 1 }),
    hasFitData(),
  ])

  const shop = shopName(locale)

  // Banner 的文案挑當前語系的欄位，沒填就退回 messages 的預設標語 ——
  // 刻意不退回 hero.title，那欄一定是中文，英文站會整段變中文。
  const isDefaultLocale = locale === defaultLocale
  const heroTitle = (isDefaultLocale ? hero?.title : hero?.titleEn?.trim()) || t('heroTitle')

  // 每張底部的 pb-16 是給輪播控制膠囊的位置；lg 的 min-h 讓四張同高。
  const slideBase = 'pb-16 lg:min-h-[min(80vh,760px)]'

  const heroSlides = [
    // 1. 店面插畫：圖本身是平塗底色，slide 底色取同一個色，邊緣才不會露出一塊方框
    <div
      key="storefront"
      className={cn(
        slideBase,
        'flex items-center justify-center bg-[#eae6dd] px-3 sm:px-6 lg:pt-16',
        // 按鈕擺在插畫上緣外側（Sagan 字樣正上方），手機多留一點上方空間給它
        showSizePick ? 'pt-16' : 'pt-10',
      )}
    >
      <div className="relative max-w-full">
        {showSizePick && (
          // 連到首頁下方的尺寸推薦區塊（ProductRecommender 的 #size-pick）。
          // 對照表沒資料時那一區不存在，按鈕也跟著不顯示，免得點了沒反應。
          <a
            href="#size-pick"
            className="absolute bottom-full left-1/2 z-10 mb-2 inline-flex h-10 -translate-x-[44%] items-center gap-2 whitespace-nowrap rounded-full bg-ink-900/90 px-5 text-sm tracking-wide text-cream-50 shadow-sm transition-colors duration-300 hover:bg-plum-700 lg:mb-3 lg:h-11 lg:px-6"
          >
            <Ruler size={16} aria-hidden />
            {t('carousel.sizePickCta')}
          </a>
        )}
        <ZoomableImage
          src={storefrontImg}
          alt={t('carousel.storefrontAlt')}
          priority
          sizes="(min-width: 1024px) 52rem, 100vw"
          className="h-auto w-auto max-w-full lg:max-h-[calc(min(80vh,760px)-8rem)]"
        />
      </div>
    </div>,

    // 2. 名言：左圖右文，整張鋪插畫同一張牛皮紙的紋理（PAPER），
    //    插畫和背景是同一張紙，不加漸層也接得起來，看起來像文字直接寫在同一張紙上。
    //    手機：插畫在上、文字在下；lg：插畫靠中線右側、文字在中線左側對齊。
    <div
      key="quote"
      style={PAPER}
      className={cn(
        'grid items-center gap-2 pb-20 [background-size:313px_110px] sm:[background-size:390px_137px] lg:[background-size:583px_205px] lg:min-h-[min(80vh,760px)] lg:grid-cols-2 lg:gap-12 lg:pb-0',
        'lg:pr-[max(1.5rem,calc((100vw-80rem)/2+1.5rem))]',
      )}
    >
      <div className="flex justify-center px-6 lg:justify-start lg:px-0">
        {/* 暖白字像印在牛皮紙上的白墨，也呼應插畫裡的白貓；牛皮紙底對白字只有約 3.3:1，
            補一層很淡的棕色陰影把字從紙紋裡托出來 */}
        <div className="w-fit max-w-full [text-shadow:0_1px_3px_rgb(58_38_20/0.45)]">
          <h1 className="fade-up text-2xl leading-[1.5] tracking-[0.08em] text-balance text-cream-50 [animation-delay:200ms] sm:text-4xl xl:text-5xl xl:leading-[1.4]">
            <BreakableTitle text={heroTitle} />
          </h1>
          <p className="fade-up mt-4 text-right text-xl tracking-[0.12em] text-cream-50 [animation-delay:450ms] sm:mt-8 sm:text-2xl">
            {t('heroAttribution')}
          </p>
        </div>
      </div>

      {/* DOM 上文字在前（h1 先被讀到），畫面上用 order-first 把圖排到上方／左方 */}
      <div className="order-first flex justify-center lg:justify-end">
        <ZoomableImage
          src={portraitImg}
          alt=""
          loading="eager"
          sizes="(min-width: 1024px) 50vw, 100vw"
          triggerClassName="w-full sm:w-auto"
          // 手機滿版：插畫左右邊緣貼齊螢幕邊，和背景紙的接縫才不會出現在畫面中間
          className="h-auto w-full sm:max-h-[48vh] sm:w-auto sm:max-w-full lg:max-h-[min(80vh,760px)]"
        />
      </div>
    </div>,

    // 3. LINE 官方帳號
    <InfoSlide
      key="line"
      className={slideBase}
      eyebrow="Customer Care"
      title={t('carousel.lineTitle')}
      body={t('carousel.lineBody')}
      visual={
        lineSupport ? (
          // QR Code 本身就是加好友連結：手機掃不了自己的螢幕，直接點比放大有用
          <a
            href={lineSupport.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('carousel.lineCta')}
            className="group/line block transition-transform duration-300 hover:-translate-y-1"
          >
            <Image
              src={lineQrImg}
              alt={t('carousel.lineQrAlt')}
              sizes="(min-width: 1024px) 18rem, (min-width: 640px) 14rem, 11rem"
              className="size-44 bg-white p-3 shadow-sm transition-shadow duration-300 group-hover/line:shadow-lg sm:size-56 lg:size-72 lg:p-4"
            />
          </a>
        ) : (
          <ZoomableImage
            src={lineQrImg}
            alt={t('carousel.lineQrAlt')}
            sizes="(min-width: 1024px) 18rem, (min-width: 640px) 14rem, 11rem"
            className="size-44 bg-white p-3 shadow-sm sm:size-56 lg:size-72 lg:p-4"
            badgeClassName="-right-3 -bottom-3"
          />
        )
      }
    >
      {lineSupport ? (
        <Button asChild className="mt-7 sm:mt-8">
          <a href={lineSupport.url} target="_blank" rel="noopener noreferrer">
            {t('carousel.lineCta')}
            <ArrowRight size={16} />
          </a>
        </Button>
      ) : (
        // 沒設定 SHOP_LINE_URL 時只有 QR Code 可用；在手機上掃不了自己的螢幕，提示改用長按辨識
        <p className="mt-5 text-xs leading-relaxed tracking-wide text-taupe-600 lg:hidden">
          {t('carousel.lineHint')}
        </p>
      )}
    </InfoSlide>,

    // 4. 黑貓宅配
    <InfoSlide
      key="delivery"
      className={slideBase}
      eyebrow="Delivery"
      title={t('carousel.deliveryTitle')}
      body={t('carousel.deliveryBody')}
      visual={
        <ZoomableImage
          src={giftImg}
          alt=""
          sizes="(min-width: 1024px) 18rem, (min-width: 640px) 14rem, 10rem"
          className="h-auto w-40 sm:w-56 lg:w-72"
        />
      }
    />,

    // 5. LUNALUZ 台灣官方授權證書：直式 3:4，字很小，點開放大才看得清楚
    <InfoSlide
      key="lunaluz"
      className={slideBase}
      eyebrow="Authorized"
      title={t('carousel.authTitle')}
      body={t('carousel.authBody', { shop })}
      visual={
        <ZoomableImage
          src={certificateImg}
          alt={t('carousel.authAlt', { shop })}
          sizes="(min-width: 1024px) 26rem, (min-width: 640px) 13rem, 10rem"
          className="h-auto w-40 shadow-md ring-1 ring-ink-900/5 sm:w-52 lg:h-[min(60vh,560px)] lg:w-auto"
        />
      }
    >
      <Button asChild variant="outline" className="mt-6 sm:mt-8">
        <Link href="/product/all?brand=lunaluz">
          {t('carousel.authCta')}
          <ArrowRight size={16} />
        </Link>
      </Button>
    </InfoSlide>,
  ]

  return (
    <>
      {/*
        Hero：四張輪播（店面 → 名言 → LINE → 宅配），沿用舊站的順序與素材。
        每張在手機都是「圖在上、字在下」的單欄，lg 以上才左右對半；
        底部 pb-16 留給輪播的控制膠囊。
      */}
      <HeroCarousel
        labels={{
          region: t('carousel.label'),
          slides: heroSlides.map((_, i) =>
            t('carousel.slide', { index: i + 1, total: heroSlides.length }),
          ),
          prev: t('carousel.prev'),
          next: t('carousel.next'),
          goTo: heroSlides.map((_, i) => t('carousel.goTo', { index: i + 1 })),
          pause: t('carousel.pause'),
          play: t('carousel.play'),
        }}
        slides={heroSlides}
      />

      {/*
        尺寸推薦：身高、體重、胸圍 → 依適穿對照表（product_fits）推薦有現貨的商品與尺寸。
        對照表還沒匯入時整區不顯示；匯入後最晚一個 revalidate 週期（5 分鐘）出現。
      */}
      {showSizePick && <ProductRecommender lineUrl={lineSupport?.url ?? null} />}

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
              {/* 3:4 直式：封面是蝦皮商品主圖，外框裁掉之後大多是 3:4 左右的模特兒照 */}
              <div className="relative aspect-[3/4]">
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

/**
 * 輪播裡「一張圖 + 一段文字」的資訊格（LINE、宅配）。
 * 手機：圖在上、字在下、置中；lg 以上：圖在左、字在右，兩欄在中線兩側對齊。
 */
function InfoSlide({
  eyebrow,
  title,
  body,
  visual,
  children,
  className,
}: {
  eyebrow: string
  title: string
  body: string
  visual: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'grid content-center items-center justify-items-center gap-7 bg-cream-100 px-6 pt-10 sm:gap-10',
        'lg:grid-cols-2 lg:gap-16 lg:pt-16',
        className,
      )}
    >
      <div className="lg:justify-self-end">{visual}</div>
      <div className="max-w-md text-center lg:justify-self-start lg:text-left">
        <p className="flex items-center justify-center gap-4 lg:justify-start">
          <span aria-hidden className="h-px w-8 bg-plum-600" />
          <span className="font-display text-base tracking-[0.12em] text-taupe-600 italic">
            {eyebrow}
          </span>
        </p>
        <h2 className="mt-4 text-2xl leading-snug tracking-[0.08em] text-balance text-ink-900 sm:text-3xl lg:text-4xl">
          {title}
        </h2>
        <p className="mt-3 text-sm leading-relaxed tracking-wide text-ink-700 sm:text-base">
          {body}
        </p>
        {children}
      </div>
    </div>
  )
}
