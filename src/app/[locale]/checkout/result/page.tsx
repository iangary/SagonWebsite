import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { CheckCircle2, Clock, XCircle, Copy, ExternalLink } from 'lucide-react'
import { Link } from '@/i18n/routing'
import { db } from '@/lib/db'
import { Button } from '@/components/ui/button'
import { Badge, ORDER_STATUS_TONE, SHIPMENT_STATUS_TONE } from '@/components/ui/badge'
import { formatTWD } from '@/lib/utils'
import { LOGISTICS_SUBTYPE_LABEL, TRACKING_URL, shipmentStatusKey } from '@/lib/ecpay/logistics'
import { ShipmentTimeline } from '@/components/order/shipment-timeline'
import { PaymentPoller } from './payment-poller'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'result' })
  return { title: t('successTitle'), robots: { index: false } }
}

export default async function CheckoutResultPage({
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

  const [t, tStatus, tShipment, order] = await Promise.all([
    getTranslations('result'),
    getTranslations('orderStatus'),
    getTranslations('shipmentStatus'),
    db.order.findUnique({
      where: { orderNo },
      include: {
        items: true,
        payment: true,
        invoice: true,
        shipment: { include: { logs: { orderBy: { occurredAt: 'desc' } } } },
      },
    }),
  ])

  if (!order) notFound()

  const payment = order.payment
  const isPaid = order.status !== 'PENDING_PAYMENT' && order.status !== 'CANCELLED'
  const isCancelled = order.status === 'CANCELLED'
  const awaitingTransfer = payment?.status === 'AWAITING_TRANSFER'
  const paymentFailed = payment?.status === 'FAILED'
  const paymentExpired = payment?.status === 'EXPIRED'

  // 已取號的 ATM／超商不給重新付款 —— 重送一次會產生新的虛擬帳號。
  const canRetryPayment = order.status === 'PENDING_PAYMENT' && !awaitingTransfer

  const trackingUrl = order.shipment ? TRACKING_URL[order.shipment.logisticsSubType] : undefined

  const heading = isCancelled
    ? { icon: XCircle, tone: 'text-sale', title: t('failedTitle') }
    : isPaid
      ? { icon: CheckCircle2, tone: 'text-taupe-500', title: t('successTitle') }
      : { icon: Clock, tone: 'text-rose-accent', title: t('pendingTitle') }

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      {/* 綠界的背景通知可能比使用者導回還慢，未付款狀態時前端輪詢幾次 */}
      {!isPaid && !isCancelled && !awaitingTransfer && <PaymentPoller orderNo={order.orderNo} />}

      <div className="text-center">
        <heading.icon size={44} strokeWidth={1} className={`mx-auto ${heading.tone}`} />
        <h1 className="mt-5 text-2xl tracking-[0.1em]">{heading.title}</h1>
        <p className="mt-3 text-sm text-taupe-600">
          {t('orderNo')}
          <span className="ml-2 font-medium tabular-nums text-ink-900">{order.orderNo}</span>
        </p>
        <div className="mt-4">
          <Badge tone={ORDER_STATUS_TONE[order.status]}>{tStatus(order.status)}</Badge>
        </div>
      </div>

      {/* 付款未完成／逾期。
          刻意不顯示 payment.failReason —— 那欄存的是內部訊息（金額不符的實際數字、
          模擬付款偵測等），對客戶沒有意義，而且等於把風控規則講給攻擊者聽。 */}
      {(paymentFailed || paymentExpired) && (
        <section className="mt-10 border border-sale/30 bg-sale/5 p-6">
          <h2 className="text-sm tracking-[0.1em] text-sale">
            {paymentExpired ? t('paymentExpiredTitle') : t('paymentFailedTitle')}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-700">
            {paymentExpired ? t('paymentExpiredHint') : t('paymentFailedHint')}
          </p>
        </section>
      )}

      {/* ATM 轉帳資訊 */}
      {awaitingTransfer && payment?.vAccount && (
        <section className="mt-10 border border-cream-300 bg-white p-6">
          <h2 className="text-sm tracking-[0.1em]">{t('atmInfo')}</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <InfoRow label={t('bankCode')} value={payment.bankCode ?? '—'} />
            <InfoRow label={t('vAccount')} value={payment.vAccount} copyable />
            <InfoRow label="轉帳金額" value={formatTWD(payment.amount)} />
            <InfoRow label={t('expireDate')} value={payment.expireDate ?? '—'} />
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-taupe-600">
            請於期限內完成轉帳。系統確認入帳後會自動更新訂單狀態並寄送通知信。
            逾期未付款的訂單會自動取消並釋放庫存。
          </p>
        </section>
      )}

      {/* 超商繳費資訊 */}
      {awaitingTransfer && payment?.paymentNo && (
        <section className="mt-10 border border-cream-300 bg-white p-6">
          <h2 className="text-sm tracking-[0.1em]">{t('cvsPaymentNo')}</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <InfoRow label="繳費代碼" value={payment.paymentNo} copyable />
            <InfoRow label="繳費金額" value={formatTWD(payment.amount)} />
            <InfoRow label={t('expireDate')} value={payment.expireDate ?? '—'} />
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-taupe-600">
            請持繳費代碼至四大超商的多媒體機台列印繳費單後至櫃台繳費。
          </p>
        </section>
      )}

      {/* 訂單內容 */}
      <section className="mt-10 border-t border-cream-200 pt-8">
        <h2 className="text-sm tracking-[0.1em]">訂單內容</h2>
        <ul className="mt-4 divide-y divide-cream-200">
          {order.items.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-4 py-3 text-sm">
              <div className="min-w-0">
                <p className="text-ink-900">{item.productName}</p>
                <p className="mt-0.5 text-xs text-taupe-500">
                  {item.variantName} × {item.qty}
                </p>
              </div>
              <span className="shrink-0 tabular-nums text-ink-700">
                {formatTWD(item.lineTotal)}
              </span>
            </li>
          ))}
        </ul>

        <dl className="mt-4 space-y-2 border-t border-cream-200 pt-4 text-sm">
          <SummaryRow label="小計" value={formatTWD(order.subtotal)} />
          {order.discountTotal > 0 && (
            <SummaryRow label="折扣" value={`-${formatTWD(order.discountTotal)}`} tone="sale" />
          )}
          <SummaryRow
            label="運費"
            value={order.shippingFee === 0 ? '免運費' : formatTWD(order.shippingFee)}
          />
          <div className="flex justify-between border-t border-cream-200 pt-2 text-base">
            <dt>總計</dt>
            <dd className="tabular-nums">{formatTWD(order.grandTotal)}</dd>
          </div>
        </dl>
      </section>

      {/* 配送資訊 */}
      {order.shipment && (
        <section className="mt-8 border-t border-cream-200 pt-8">
          <h2 className="text-sm tracking-[0.1em]">配送資訊</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <InfoRow
              label="配送方式"
              value={LOGISTICS_SUBTYPE_LABEL[order.shipment.logisticsSubType]}
            />
            <div className="flex items-baseline justify-between gap-4">
              <dt className="shrink-0 text-taupe-600">{t('shipmentStatusLabel')}</dt>
              <dd className="text-right">
                <Badge tone={SHIPMENT_STATUS_TONE[order.shipment.status]}>
                  {tShipment(
                    shipmentStatusKey(order.shipment.status, order.shipment.logisticsSubType),
                  )}
                </Badge>
              </dd>
            </div>
            {order.shipment.shipmentNo && (
              <InfoRow label={t('shipmentNo')} value={order.shipment.shipmentNo} copyable />
            )}
            <InfoRow label="收件人" value={order.shipment.receiverName} />
            {order.shipment.cvsStoreName ? (
              <>
                <InfoRow label="取貨門市" value={order.shipment.cvsStoreName} />
                <InfoRow label="門市地址" value={order.shipment.cvsAddress ?? '—'} />
              </>
            ) : (
              <InfoRow label="收件地址" value={order.shipment.receiverAddress ?? '—'} />
            )}
            {order.invoice?.invoiceNumber && (
              <InfoRow label={t('invoiceNumber')} value={order.invoice.invoiceNumber} />
            )}
          </dl>

          {/* 查詢頁多半不吃 query string 帶單號，所以是「顯示單號 + 外連」讓客戶自己貼 */}
          {trackingUrl && order.shipment.shipmentNo && (
            <a
              href={trackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 text-xs text-ink-900 underline underline-offset-4"
            >
              {t('trackAt', {
                carrier: LOGISTICS_SUBTYPE_LABEL[order.shipment.logisticsSubType],
              })}
              <ExternalLink size={12} aria-hidden />
            </a>
          )}
        </section>
      )}

      {order.shipment && (
        <ShipmentTimeline
          logs={order.shipment.logs}
          subType={order.shipment.logisticsSubType}
        />
      )}

      <div className="mt-12 flex flex-col gap-3 sm:flex-row sm:justify-center">
        {canRetryPayment && (
          <Button asChild>
            {/* 原生 <a>：/api/* 在 locale 路由之外，用 next-intl 的 Link 會被加語系前綴而 404 */}
            <a href={`/api/ecpay/payment/checkout/${order.orderNo}`}>{t('retryPayment')}</a>
          </Button>
        )}
        <Button asChild variant="outline">
          <Link href="/account/orders">{t('viewOrder')}</Link>
        </Button>
        <Button asChild variant={canRetryPayment ? 'outline' : undefined}>
          <Link href="/">{t('backHome')}</Link>
        </Button>
      </div>
    </div>
  )
}

function InfoRow({
  label,
  value,
  copyable,
}: {
  label: string
  value: string
  copyable?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-taupe-600">{label}</dt>
      <dd className="text-right text-ink-900">
        <span className={copyable ? 'font-medium tabular-nums' : ''}>{value}</span>
        {copyable && <Copy size={12} className="ml-1.5 inline text-taupe-400" aria-hidden />}
      </dd>
    </div>
  )
}

function SummaryRow({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'sale'
}) {
  return (
    <div className="flex justify-between">
      <dt className="text-ink-700">{label}</dt>
      <dd className={`tabular-nums ${tone === 'sale' ? 'text-sale' : 'text-ink-900'}`}>{value}</dd>
    </div>
  )
}
