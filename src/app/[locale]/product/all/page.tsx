import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { env } from '@/lib/env'
import { formatTWD } from '@/lib/utils'
import { shopName } from '@/lib/shop-config'
import { ProductListing, type ListingSearchParams } from '@/components/product/product-listing'

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<ListingSearchParams>
}): Promise<Metadata> {
  const { locale } = await params
  const [t, tSeo, sp] = await Promise.all([
    getTranslations({ locale, namespace: 'nav' }),
    getTranslations({ locale, namespace: 'seo' }),
    searchParams,
  ])

  return {
    title: sp.q ? t('search') : t('allProducts'),
    description: tSeo('allProductsDescription', {
      shop: shopName(locale),
      threshold: formatTWD(env.FREE_SHIPPING_THRESHOLD),
    }),
    alternates: { canonical: '/product/all' },
    // 帶 ?q= 時是站內搜尋結果，不該進索引（follow 保留，權重仍流向商品頁）
    ...(sp.q ? { robots: { index: false, follow: true } } : {}),
  }
}

export default async function AllProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<ListingSearchParams>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const sp = await searchParams
  const t = await getTranslations('nav')

  return (
    <ProductListing
      title={sp.q ? t('search') : t('allProducts')}
      basePath="/product/all"
      searchParams={sp}
    />
  )
}
