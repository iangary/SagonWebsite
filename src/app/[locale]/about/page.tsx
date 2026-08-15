import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { env } from '@/lib/env'
import { listBrands } from '@/lib/catalog/queries'
import { shopName } from '@/lib/shop-config'
import { pickLocalized } from '@/lib/i18n/localized'
import { Link } from '@/i18n/routing'

export const revalidate = 3600

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'nav' })
  return { title: t('about'), alternates: { canonical: '/about' } }
}

export default async function AboutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const [t, tCommon, brands] = await Promise.all([
    getTranslations('about'),
    getTranslations('common'),
    listBrands(),
  ])
  const shop = shopName(locale)

  return (
    <article className="mx-auto max-w-3xl px-6 py-16">
      <p className="text-xs tracking-[0.3em] text-taupe-600 uppercase">About</p>
      <h1 className="mt-4 text-3xl leading-relaxed">{t('title', { shop })}</h1>

      <div className="mt-10 space-y-6 text-sm leading-loose text-ink-700">
        <p>{t('intro', { shop })}</p>
        <p>{t('curation')}</p>
        <blockquote className="border-l-2 border-taupe-400 py-1 pl-5 text-base italic text-ink-900">
          {t('quote')}
        </blockquote>
      </div>

      <section className="mt-16">
        <h2 className="text-xl tracking-[0.12em]">{t('brandsTitle')}</h2>
        <ul className="mt-6 divide-y divide-cream-200 border-y border-cream-200">
          {brands.map((brand) => (
            <li key={brand.slug}>
              <Link
                href={`/product/all?brand=${brand.slug}`}
                className="flex items-center justify-between gap-6 py-4 transition-colors hover:text-taupe-600"
              >
                <div>
                  <p className="text-sm tracking-[0.1em] text-ink-900">{brand.name}</p>
                  {brand.description && (
                    <p className="mt-1 text-xs text-taupe-500">
                      {pickLocalized(locale, brand.description, brand.descriptionEn)}
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-xs text-taupe-400">
                  {t('brandProductCount', { count: brand._count.products })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-16 bg-cream-100 p-8">
        <h2 className="text-base tracking-[0.12em]">{t('shopInfoTitle')}</h2>
        <dl className="mt-5 space-y-2 text-sm text-ink-700">
          <div>
            <dt className="inline text-taupe-600">
              {t('shopNameLabel')}
              {tCommon('colon')}
            </dt>
            <dd className="inline">{shop}</dd>
          </div>
          <div>
            <dt className="inline text-taupe-600">
              {t('taxIdLabel')}
              {tCommon('colon')}
            </dt>
            <dd className="inline">{env.SHOP_TAX_ID}</dd>
          </div>
          <div>
            <dt className="inline text-taupe-600">
              {t('emailLabel')}
              {tCommon('colon')}
            </dt>
            <dd className="inline">{env.SHOP_SERVICE_EMAIL}</dd>
          </div>
          <div>
            <dt className="inline text-taupe-600">
              {t('hoursLabel')}
              {tCommon('colon')}
            </dt>
            <dd className="inline">{t('hoursValue')}</dd>
          </div>
        </dl>
      </section>
    </article>
  )
}
