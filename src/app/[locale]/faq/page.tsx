import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/routing'
import { env } from '@/lib/env'
import { formatTWD } from '@/lib/utils'

/**
 * 答案維持純文字 —— 它同時餵給頁面與 FAQPage 結構化資料。
 * 需要延伸閱讀時用 more 帶一個連結，不要把 JSX 混進 a。
 */
type FaqItem = {
  q: string
  a: string
  more?: { href: string; label: string }
}

export const revalidate = 3600

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'nav' })
  return { title: t('faq'), alternates: { canonical: '/faq' } }
}

export default async function FaqPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  const t = await getTranslations('faq')

  const groups: { title: string; items: FaqItem[] }[] = [
    {
      title: t('orderingTitle'),
      items: [
        { q: t('q_payment'), a: t('a_payment') },
        { q: t('q_modify'), a: t('a_modify', { email: env.SHOP_SERVICE_EMAIL }) },
        { q: t('q_coupon'), a: t('a_coupon') },
      ],
    },
    {
      title: t('shippingTitle'),
      items: [
        {
          q: t('q_fee'),
          a: t('a_fee', {
            cvs: formatTWD(env.SHIPPING_FEE_CVS),
            home: formatTWD(env.SHIPPING_FEE_HOME),
            threshold: formatTWD(env.FREE_SHIPPING_THRESHOLD),
          }),
        },
        { q: t('q_dispatch'), a: t('a_dispatch') },
        { q: t('q_cvs'), a: t('a_cvs') },
      ],
    },
    {
      title: t('returnsTitle'),
      items: [
        { q: t('q_invoice'), a: t('a_invoice') },
        {
          q: t('q_returns'),
          a: t('a_returns'),
          more: { href: '/returns', label: t('more_returns') },
        },
        {
          q: t('q_refund'),
          a: t('a_refund'),
          more: { href: '/returns', label: t('more_refund') },
        },
      ],
    },
  ]

  // FAQ 結構化資料，讓搜尋結果可以直接展開問答
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: groups.flatMap((g) =>
      g.items.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.a },
      })),
    ),
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-xs tracking-[0.3em] text-taupe-600 uppercase">FAQ</p>
        <h1 className="mt-4 text-3xl">{t('title')}</h1>

        {groups.map((group) => (
          <section key={group.title} className="mt-14">
            <h2 className="text-lg tracking-[0.12em]">{group.title}</h2>
            <dl className="mt-6 divide-y divide-cream-200 border-y border-cream-200">
              {group.items.map((item) => (
                <div key={item.q} className="py-6">
                  <dt className="text-sm text-ink-900">{item.q}</dt>
                  <dd className="mt-2.5 text-sm leading-loose text-ink-700">
                    {item.a}
                    {item.more && (
                      <Link
                        href={item.more.href}
                        className="mt-2 block text-ink-900 underline underline-offset-4"
                      >
                        {item.more.label}
                      </Link>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </>
  )
}
