import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { getCategoryBySlug } from '@/lib/catalog/queries'
import { getShippingSettings } from '@/lib/shop-settings'
import { formatTWD } from '@/lib/utils'
import { shopName } from '@/lib/shop-config'
import { localizedName } from '@/lib/i18n/localized'
import { ProductListing, type ListingSearchParams } from '@/components/product/product-listing'

// 同商品頁：不提供 generateStaticParams，也不設 revalidate，
// 否則整條路由會落進 fallback: blocking 而每個請求都回 500。理由寫在
// product/[slug]/page.tsx。這頁還多讀 searchParams（篩選、分頁），
// 本來就不該靜態化。

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>
  searchParams: Promise<ListingSearchParams>
}): Promise<Metadata> {
  const { locale, slug } = await params
  const category = await getCategoryBySlug(decodeURIComponent(slug))
  if (!category) return {}

  const [t, sp, shipping] = await Promise.all([
    getTranslations({ locale, namespace: 'seo' }),
    searchParams,
    getShippingSettings(),
  ])
  const name = localizedName(locale, category)

  return {
    title: name,
    /*
     * 分類頁是最容易吃到品類字（「韓國睡衣」「絲質睡衣」）的頁面，
     * 描述空著等於放棄搜尋結果上的說服機會。
     *
     * 目前是樣板兜底 —— Category 還沒有可編輯的 seoDescription 欄位，
     * 那需要一次 migration 與後台表單。加了欄位之後這裡改成
     * `category.seoDescription ?? t('categoryDescription', …)`。
     */
    description: t('categoryDescription', {
      count: category._count.products,
      name,
      shop: shopName(locale),
      threshold: formatTWD(shipping.freeShippingThreshold),
    }),
    alternates: { canonical: `/category/${category.slug}` },
    openGraph: { type: 'website', title: name },
    // 站內搜尋結果頁 Google 明文不建議索引；follow 保留，讓權重繼續流向商品頁
    ...(sp.q ? { robots: { index: false, follow: true } } : {}),
  }
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>
  searchParams: Promise<ListingSearchParams>
}) {
  const { locale, slug } = await params
  setRequestLocale(locale)

  // 分類 slug 含中文，網址列會是百分比編碼，要先解回來才比對得到
  const category = await getCategoryBySlug(decodeURIComponent(slug))
  if (!category) notFound()

  const sp = await searchParams

  return (
    <ProductListing
      title={localizedName(locale, category)}
      basePath={`/category/${slug}`}
      searchParams={sp}
      categorySlug={category.slug}
      showBrandFilter={false}
    />
  )
}
