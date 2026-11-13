import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/routing'
import { getStorefrontBundleBySlug } from '@/lib/bundles'
import { formatTWD, truncate } from '@/lib/utils'
import { BundlePriceTag, BundleThumbs } from '@/components/bundle/bundle-card'
import { BundleBuilder } from '@/components/bundle/bundle-builder'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}): Promise<Metadata> {
  const { locale, slug } = await params
  const [t, bundle] = await Promise.all([
    getTranslations({ locale, namespace: 'bundles' }),
    getStorefrontBundleBySlug(locale, decodeURIComponent(slug)),
  ])
  if (!bundle) return {}

  return {
    title: bundle.name,
    description: truncate(
      bundle.description ??
        `${bundle.name} — ${t('bundlePrice')} ${formatTWD(bundle.price)}`,
      160,
    ),
    alternates: { canonical: `/bundles/${bundle.slug}` },
  }
}

export default async function BundlePage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}) {
  const { locale, slug } = await params
  setRequestLocale(locale)

  const bundle = await getStorefrontBundleBySlug(locale, decodeURIComponent(slug))
  if (!bundle) notFound()

  const [t, tNav] = await Promise.all([getTranslations('bundles'), getTranslations('nav')])

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <nav aria-label={tNav('breadcrumb')}>
        <ol className="flex flex-wrap items-center gap-1.5 text-xs text-taupe-500">
          <li>
            <Link href="/" className="hover:text-ink-900">
              {tNav('home')}
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li>
            <Link href="/bundles" className="hover:text-ink-900">
              {t('title')}
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li className="line-clamp-1 text-ink-700">{bundle.name}</li>
        </ol>
      </nav>

      <div className="mt-8 gap-12 lg:flex">
        <div className="lg:w-[46%]">
          <BundleThumbs bundle={bundle} sizes="(min-width: 1024px) 40vw, 90vw" />
        </div>

        <div className="mt-10 lg:mt-0 lg:flex-1">
          <p className="text-xs tracking-[0.15em] text-sale uppercase">{t('title')}</p>
          <h1 className="mt-2 text-2xl leading-relaxed">{bundle.name}</h1>
          <div className="mt-4">
            <BundlePriceTag bundle={bundle} size="lg" />
          </div>
          {bundle.description && (
            <p className="mt-5 whitespace-pre-line text-sm leading-relaxed text-ink-700">
              {bundle.description}
            </p>
          )}

          <hr className="my-7 border-cream-200" />

          <BundleBuilder bundle={bundle} />
        </div>
      </div>
    </div>
  )
}
