import { getLocale, getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/routing'
import { env } from '@/lib/env'
import Image from 'next/image'
import { lineSupport, shopName } from '@/lib/shop-config'
import logoImg from '@/assets/brand/sagan-logo.png'

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
    { href: '/bundles', label: tNav('bundles') },
    { href: '/about', label: tNav('about') },
    { href: '/journal', label: tNav('journal') },
    { href: '/contact', label: tNav('contact') },
    { href: '/order/query', label: tNav('orderQuery') },
    { href: '/faq', label: tNav('faq') },
  ]

  const legalLinks = [
    { href: '/returns', label: tNav('returns') },
    { href: '/terms', label: tNav('terms') },
    { href: '/privacy', label: tNav('privacy') },
  ]

  // 站外連結，設成空字串的就不顯示（見 lib/env.ts）
  const socialLinks = [
    { href: lineSupport?.url ?? '', label: 'LINE' },
    { href: env.SHOP_INSTAGRAM_URL, label: 'Instagram' },
    { href: env.SHOP_FACEBOOK_URL, label: 'Facebook' },
  ].filter((link) => link.href)

  const storeLinks = [
    { href: env.SHOP_PINKOI_URL, label: 'Pinkoi' },
    { href: env.SHOP_SHOPEE_URL, label: t('shopee') },
  ].filter((link) => link.href)

  const pillClass =
    'inline-flex items-center rounded-full border border-cream-300 px-4 py-1.5 text-ink-700 transition-colors hover:border-taupe-500 hover:text-taupe-600'

  return (
    <footer className="mt-20 border-t border-cream-200 bg-cream-100">
      <div className="mx-auto grid max-w-7xl gap-10 px-6 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-2">
          {/* 頁尾的 logo 放大一點，下面那行「莎岡選品店」才看得清楚（header 裡的太小） */}
          <h3>
            <Image src={logoImg} alt={shop} sizes="160px" className="h-[4.5rem] w-auto" />
          </h3>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-700">
            {t('description')}
          </p>

          {socialLinks.length > 0 && (
            <div className="mt-6">
              <h4 className="text-xs font-medium tracking-[0.15em] text-taupe-600 uppercase">
                {t('followUs')}
              </h4>
              <ul className="mt-3 flex flex-wrap gap-2 text-sm">
                {socialLinks.map((link) => (
                  <li key={link.href}>
                    <a href={link.href} target="_blank" rel="noopener noreferrer" className={pillClass}>
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {storeLinks.length > 0 && (
            <div className="mt-6">
              <h4 className="text-xs font-medium tracking-[0.15em] text-taupe-600 uppercase">
                {t('otherStores')}
              </h4>
              <ul className="mt-3 flex flex-wrap gap-2 text-sm">
                {storeLinks.map((link) => (
                  <li key={link.href}>
                    <a href={link.href} target="_blank" rel="noopener noreferrer" className={pillClass}>
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
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
          <p className="text-center sm:text-left">{t('copyright', { year, shop })}</p>
        </div>
      </div>
    </footer>
  )
}
