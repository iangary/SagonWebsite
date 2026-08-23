import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { ArrowLeft } from 'lucide-react'
import { Link } from '@/i18n/routing'
import { db } from '@/lib/db'
import { shopName } from '@/lib/shop-config'
import { buildPaymentSlipSvg } from '@/lib/barcode/payment-slip'
import { currentPaymentOf } from '@/lib/orders/payment'
import { SlipViewer } from './slip-viewer'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'slip' })
  return { title: t('title'), robots: { index: false } }
}

/**
 * 繳費單（可列印、可存成圖片）。
 *
 * 只有還在等繳費的訂單才有內容 —— 已付款或已取消的單進來會被導回訂單頁，
 * 免得消費者拿著失效的代碼跑一趟超商。
 */
export default async function PaymentSlipPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ orderNo?: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const { orderNo } = await searchParams
  if (!orderNo) notFound()

  const [t, order] = await Promise.all([
    getTranslations('slip'),
    db.order.findUnique({
      where: { orderNo },
      include: { payments: { orderBy: { createdAt: 'desc' } } },
    }),
  ])

  if (!order) notFound()

  const payment = currentPaymentOf(order.payments)
  const hasPaymentInfo =
    payment?.status === 'AWAITING_TRANSFER' &&
    Boolean(payment.paymentNo || payment.vAccount || payment.barcode1)

  if (!payment || !hasPaymentInfo) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16 text-center">
        <h1 className="text-xl tracking-[0.1em]">{t('title')}</h1>
        <p className="mt-4 text-sm text-taupe-600">{t('unavailable')}</p>
        <Link
          href={`/checkout/result?orderNo=${order.orderNo}`}
          className="mt-6 inline-flex items-center gap-1.5 text-sm text-ink-900 underline underline-offset-4"
        >
          <ArrowLeft size={14} />
          {t('backToOrder')}
        </Link>
      </div>
    )
  }

  const svg = buildPaymentSlipSvg({
    shopName: shopName(locale),
    orderNo: order.orderNo,
    amount: payment.amount,
    expireDate: payment.expireDate,
    paymentNo: payment.paymentNo,
    barcodes: [payment.barcode1, payment.barcode2, payment.barcode3],
    bankCode: payment.bankCode,
    vAccount: payment.vAccount,
  })

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Link
        href={`/checkout/result?orderNo=${order.orderNo}`}
        className="inline-flex items-center gap-1.5 text-sm text-taupe-600 hover:text-ink-900 print:hidden"
      >
        <ArrowLeft size={14} />
        {t('backToOrder')}
      </Link>

      <h1 className="mt-6 text-2xl tracking-[0.1em] print:hidden">{t('title')}</h1>
      <p className="mt-2 text-sm text-taupe-600 print:hidden">{t('intro')}</p>

      <div className="mt-8">
        <SlipViewer svg={svg} orderNo={order.orderNo} paymentNo={payment.paymentNo} />
      </div>
    </div>
  )
}
