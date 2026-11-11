import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/routing'
import { lineSupport } from '@/lib/shop-config'
import {
  getPaymentSettings,
  getShippingSettings,
  isBankTransferAvailable,
} from '@/lib/shop-settings'
import { formatTWD } from '@/lib/utils'

/**
 * 答案維持純文字 —— 它同時餵給頁面與 FAQPage 結構化資料。
 * 需要延伸閱讀時用 more 帶一個連結，不要把 JSX 混進 a。
 * 多段答案用 \n 分隔，畫面上以 whitespace-pre-line 換行。
 */
type FaqItem = {
  q: string
  a: string
  /** external = 站外連結（官方 LINE），不走 i18n 的 Link 以免被加上語系前綴 */
  more?: { href: string; label: string; external?: boolean }
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

  const [t, shipping, payment] = await Promise.all([
    getTranslations('faq'),
    getShippingSettings(),
    getPaymentSettings(),
  ])

  // 付款方式跟著後台開關走，關掉的方式不能還寫在 FAQ 上
  const bankOn = isBankTransferAvailable(payment)
  const bankDays = payment.bankExpireDays
  const paymentLines = [
    payment.prepayEnabled && payment.methods.Credit && t('a_paymentCredit'),
    payment.prepayEnabled &&
      (payment.methods.ATM || payment.methods.CVS || payment.methods.BARCODE) &&
      t('a_paymentEcpayOffline'),
    bankOn && t('a_paymentBank', { days: bankDays }),
    payment.codEnabled && t('a_paymentCod'),
    t('a_paymentTail'),
  ].filter((line): line is string => Boolean(line))

  const lineLink = lineSupport
    ? { href: lineSupport.url, label: t('more_line'), external: true }
    : undefined

  const groups: { title: string; items: FaqItem[] }[] = [
    {
      title: t('paymentTitle'),
      items: [
        { q: t('q_payment'), a: paymentLines.join('\n') },
        ...(bankOn ? [{ q: t('q_bank'), a: t('a_bank', { days: bankDays }), more: lineLink }] : []),
        { q: t('q_coupon'), a: t('a_coupon') },
      ],
    },
    {
      title: t('shippingTitle'),
      items: [
        {
          q: t('q_fee'),
          a: t(shipping.cvsEnabled ? 'a_fee' : 'a_feeHomeOnly', {
            cvs: formatTWD(shipping.cvsFee),
            home: formatTWD(shipping.homeFee),
            threshold: formatTWD(shipping.freeShippingThreshold),
          }),
        },
        { q: t('q_home'), a: t('a_home') },
        ...(shipping.cvsEnabled ? [{ q: t('q_cvs'), a: t('a_cvs') }] : []),
      ],
    },
    {
      title: t('orderTitle'),
      items: [
        { q: t('q_established'), a: t('a_established') },
        { q: t('q_dispatch'), a: t('a_dispatch') },
        { q: t('q_preorder'), a: t('a_preorder'), more: lineLink },
        { q: t('q_invoice'), a: t('a_invoice') },
      ],
    },
    {
      title: t('noticeTitle'),
      items: [
        { q: t('q_cancel'), a: t('a_cancel') },
        { q: t('q_unpaid'), a: t('a_unpaid') },
        { q: t('q_supply'), a: t('a_supply'), more: lineLink },
      ],
    },
    {
      title: t('afterSalesTitle'),
      items: [
        { q: t('q_contact'), a: t('a_contact'), more: lineLink },
        {
          q: t('q_returns'),
          a: t('a_returns'),
          more: { href: '/returns', label: t('more_returns') },
        },
        { q: t('q_defect'), a: t('a_defect'), more: lineLink },
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
                  <dd className="mt-2.5 text-sm leading-loose whitespace-pre-line text-ink-700">
                    {item.a}
                    {item.more &&
                      (item.more.external ? (
                        <a
                          href={item.more.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 block text-ink-900 underline underline-offset-4"
                        >
                          {item.more.label}
                        </a>
                      ) : (
                        <Link
                          href={item.more.href}
                          className="mt-2 block text-ink-900 underline underline-offset-4"
                        >
                          {item.more.label}
                        </Link>
                      ))}
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
