import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { db } from '@/lib/db'
import { getCategoryBySlug } from '@/lib/catalog/queries'
import { localizedName } from '@/lib/i18n/localized'
import { ProductListing, type ListingSearchParams } from '@/components/product/product-listing'

export const revalidate = 300

export async function generateStaticParams() {
  // 同商品頁：建置階段連不到資料庫就回空陣列，改由 ISR 在執行期產生
  try {
    const categories = await db.category.findMany({ select: { slug: true } })
    return categories.map((c) => ({ slug: c.slug }))
  } catch {
    return []
  }
}

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
