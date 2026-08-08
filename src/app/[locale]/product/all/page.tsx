import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { ProductListing, type ListingSearchParams } from '@/components/product/product-listing'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'nav' })
  return {
    title: t('allProducts'),
    alternates: { canonical: '/product/all' },
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
