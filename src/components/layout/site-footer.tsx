import { getLocale, getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/routing'
import { env } from '@/lib/env'
import { shopName } from '@/lib/shop-config'

export async function SiteFooter() {
  const [t, tNav, tCommon, locale] = await Promise.all([
    getTranslations('footer'),
    getTranslations('nav'),
    getTranslations('common'),
    getLocale(),
  ])
  const year = new Date().getFullYear()
  const shop = shopName(locale)

  const serviceLinks = [
    { href: '/about', label: tNav('about') },
    { href: '/contact', label: tNav('contact') },
    { href: '/order/query', label: tNav('orderQuery') },
    { href: '/faq', label: tNav('faq') },
  ]

  const legalLinks = [
    { href: '/returns', label: tNav('returns') },
    { href: '/terms', label: tNav('terms') },
    { href: '/privacy', label: tNav('privacy') },
  ]

  return (
    <footer className="mt-20 border-t border-cream-200 bg-cream-100">
      <div className="mx-auto grid max-w-7xl gap-10 px-6 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-2">
          <h3 className="font-serif-display text-lg tracking-[0.2em] text-ink-900">{shop}</h3>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-700">
            {t('description')}
          </p>
        </div>

        <div>
          <h4 className="text-xs font-medium tracking-[0.15em] text-taupe-600 uppercase">
            {t('customerService')}
          </h4>
          <ul className="mt-4 space-y-2.5 text-sm">
            {serviceLinks.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="text-ink-700 transition-colors hover:text-taupe-600">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="text-xs font-medium tracking-[0.15em] text-taupe-600 uppercase">
            {t('shopInfo')}
          </h4>
          <dl className="mt-4 space-y-2.5 text-sm text-ink-700">
            <div>
              <dt className="inline">
                {t('taxId')}
                {tCommon('colon')}
              </dt>
              <dd className="inline">{env.SHOP_TAX_ID}</dd>
            </div>
            <div>
              <dt className="inline">
                {t('email')}
                {tCommon('colon')}
              </dt>
              <dd className="inline">{env.SHOP_SERVICE_EMAIL}</dd>
            </div>
            <div>
              <dt className="inline">
                {t('serviceHours')}
                {tCommon('colon')}
              </dt>
              <dd className="inline">{t('serviceHoursValue')}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="border-t border-cream-200 px-6 py-5">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 text-xs text-taupe-500">
          <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 sm:justify-start">
            {legalLinks.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="transition-colors hover:text-ink-700">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="flex flex-col items-center justify-between gap-2 sm:flex-row">
            <p>{t('copyright', { year, shop })}</p>
            <p>{t('disclaimer')}</p>
          </div>
        </div>
      </div>
    </footer>
  )
}
