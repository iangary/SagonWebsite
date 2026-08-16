import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { getCategoryBySlug } from '@/lib/catalog/queries'
import { localizedName } from '@/lib/i18n/localized'
import { ProductListing, type ListingSearchParams } from '@/components/product/product-listing'

// 同商品頁：不提供 generateStaticParams，也不設 revalidate，
// 否則整條路由會落進 fallback: blocking 而每個請求都回 500。理由寫在
// product/[slug]/page.tsx。這頁還多讀 searchParams（篩選、分頁），
// 本來就不該靜態化。

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}): Promise<Metadata> {
  const { locale, slug } = await params
  const category = await getCategoryBySlug(decodeURIComponent(slug))
  if (!category) return {}
  return {
    title: localizedName(locale, category),
    alternates: { canonical: `/category/${category.slug}` },
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
