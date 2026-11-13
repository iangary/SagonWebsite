import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/routing'
import { getStorefrontBundles } from '@/lib/bundles'
import { BundleCard } from '@/components/bundle/bundle-card'

/** 動態渲染：組合的上下架、商品庫存都要即時反映（理由同商品頁，見 product/[slug]/page.tsx）。 */
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'bundles' })
  return {
    title: t('title'),
    description: t('metaDescription'),
    alternates: { canonical: '/bundles' },
  }
}

export default async function BundlesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  const [t, bundles] = await Promise.all([
    getTranslations('bundles'),
    getStorefrontBundles(locale),
  ])

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="text-2xl tracking-[0.12em]">{t('title')}</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-taupe-600">{t('intro')}</p>

      {bundles.length === 0 ? (
        <div className="py-24 text-center">
          <p className="text-ink-700">{t('empty')}</p>
          <Link
            href="/product/all"
            className="mt-6 inline-block text-sm text-ink-900 underline underline-offset-4"
          >
            {t('browseProducts')}
          </Link>
        </div>
      ) : (
        <ul className="mt-10 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {bundles.map((bundle) => (
            <li key={bundle.id}>
              <BundleCard bundle={bundle} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
