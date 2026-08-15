import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Mail, Clock, Building2, Package } from 'lucide-react'
import { Link } from '@/i18n/routing'
import { env } from '@/lib/env'
import { shopName } from '@/lib/shop-config'

export const revalidate = 3600

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'nav' })
  return { title: t('contact'), alternates: { canonical: '/contact' } }
}

export default async function ContactPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('contact')

  const channels = [
    {
      icon: Mail,
      title: t('emailTitle'),
      body: env.SHOP_SERVICE_EMAIL,
      note: t('emailNote'),
    },
    {
      icon: Clock,
      title: t('hoursTitle'),
      body: t('hoursValue'),
      note: t('hoursNote'),
    },
    {
      icon: Building2,
      title: t('companyTitle'),
      body: t('companyValue', { shop: shopName(locale), taxId: env.SHOP_TAX_ID }),
      note: t('companyNote'),
    },
  ]

  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <p className="text-xs tracking-[0.3em] text-taupe-600 uppercase">Contact</p>
      <h1 className="mt-4 text-3xl">{t('title')}</h1>
      <p className="mt-5 text-sm leading-loose text-ink-700">{t('intro')}</p>

      <ul className="mt-12 space-y-px bg-cream-200">
        {channels.map((channel) => (
          <li key={channel.title} className="flex items-start gap-4 bg-cream-50 p-6">
            <channel.icon size={20} strokeWidth={1.5} className="mt-0.5 shrink-0 text-taupe-500" />
            <div>
              <p className="text-xs tracking-wide text-taupe-600">{channel.title}</p>
              <p className="mt-1 text-sm text-ink-900">{channel.body}</p>
              <p className="mt-1 text-xs text-taupe-500">{channel.note}</p>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-10 flex items-start gap-4 border border-cream-300 p-6">
        <Package size={20} strokeWidth={1.5} className="mt-0.5 shrink-0 text-taupe-500" />
        <div>
          <p className="text-sm text-ink-900">{t('orderQueryTitle')}</p>
          <p className="mt-1 text-sm text-ink-700">{t('orderQueryBody')}</p>
          <Link
            href="/order/query"
            className="mt-3 inline-block text-sm text-ink-900 underline underline-offset-4"
          >
            {t('orderQueryCta')}
          </Link>
        </div>
      </div>
    </div>
  )
}
