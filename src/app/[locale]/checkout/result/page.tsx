import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { CheckCircle2, Clock, XCircle, Copy, ExternalLink, Printer } from 'lucide-react'
import { Link } from '@/i18n/routing'
import { db } from '@/lib/db'
import { currentUser } from '@/lib/auth'
import { getPaymentSettings, isBankTransferAvailable } from '@/lib/shop-settings'
import { currentPaymentOf } from '@/lib/orders/payment'
import { bankAccountOf } from '@/lib/orders/bank-transfer'
import { refundEligibility } from '@/lib/orders/refund'
import { PAYMENT_CHOICE_LABEL_KEY } from '@/lib/orders/labels'
import { Button } from '@/components/ui/button'
import { Badge, ORDER_STATUS_TONE, SHIPMENT_STATUS_TONE } from '@/components/ui/badge'
import { formatTWD } from '@/lib/utils'
import { TRACKING_URL, shipmentStatusKey } from '@/lib/ecpay/logistics'
import { ShipmentTimeline } from '@/components/order/shipment-timeline'
import { PaymentPoller } from './payment-poller'
import { PaymentSwitcher, type SwitchableChoice } from './payment-switcher'
import { RefundContact } from './refund-contact'

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

  const [t, tStatus, tShipment, tLogistics, tCheckout, settings, viewer, order] =
    await Promise.all([
      getTranslations('result'),
      getTranslations('orderStatus'),
      getTranslations('shipmentStatus'),
      getTranslations('logistics'),
      getTranslations('checkout'),
      getPaymentSettings(),
      currentUser(),
      db.order.findUnique({
        where: { orderNo },
        include: {
          items: true,
          payments: { orderBy: { createdAt: 'desc' } },
          invoice: true,
          refunds: { orderBy: { createdAt: 'desc' } },
          shipment: { include: { logs: { orderBy: { occurredAt: 'desc' } } } },
        },
      }),
    ])

  if (!order) notFound()

  const payment = currentPaymentOf(order.payments)
  const isPaid = order.status !== 'PENDING_PAYMENT' && order.status !== 'CANCELLED'
  const isCancelled = order.status === 'CANCELLED'
  const awaitingTransfer = payment?.status === 'AWAITING_TRANSFER'
  // 匯款：帳號不存在 payment 上（只有一組公司帳戶），顯示時從設定讀
  const awaitingBankTransfer = awaitingTransfer && payment?.provider === 'BANK'
  const bankAccount = bankAccountOf(settings)
  const awaitingCollection = payment?.status === 'AWAITING_COLLECTION'
  const paymentFailed = payment?.status === 'FAILED'
  const paymentExpired = payment?.status === 'EXPIRED'

  // 已取號的 ATM／超商不給用同一筆重新付款 —— 重送一次會產生新的虛擬帳號。
  // 想換方式的人走下面的 PaymentSwitcher（會作廢舊代碼、開一筆新的）。
  const canRetryPayment = order.status === 'PENDING_PAYMENT' && !awaitingTransfer

  // 繳費單只在「已取號、還沒繳」時有意義
  const hasSlip =
    awaitingTransfer && Boolean(payment?.paymentNo || payment?.vAccount || payment?.barcode1)

  /**
   * 待付款期間可以改用哪些付款方式。
   * 貨到付款要看後台設定與金額上限（超商代收上限 2 萬）。
   */
  const codLimit =
    order.shippingMethod === 'CVS'
      ? Math.min(settings.codMaxAmount, 20_000)
      : settings.codMaxAmount
  const switchChoices: SwitchableChoice[] = [
    ...(settings.prepayEnabled
      ? (['Credit', 'ATM', 'CVS', 'BARCODE'] as const).filter((m) => settings.methods[m])
      : []),
    ...(isBankTransferAvailable(settings) ? (['BANK'] as const) : []),
    ...(settings.codEnabled &&
    settings.codShippingMethods.includes(order.shippingMethod) &&
    order.grandTotal <= codLimit
      ? (['COD'] as const)
      : []),
  ]
  const canChangePayment = order.status === 'PENDING_PAYMENT' && switchChoices.length > 1

  // 訪客（訂單沒綁會員，或不是本人在看）動手之前要用 Email／手機確認身分
  const needsContact = !(viewer && order.userId && viewer.id === order.userId)

  const refund = refundEligibility(order, settings)
  const openRefund = order.refunds.find(
    (r) => r.status === 'REQUESTED' || r.status === 'APPROVED',
  )

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
        {payment && (
          <p className="mt-3 text-xs text-taupe-600">
            {t('paymentMethodLabel')}
            {' '}
            {tCheckout(PAYMENT_CHOICE_LABEL_KEY[payment.choosePayment] ?? 'credit')}
          </p>
        )}
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

      {/* 貨到付款：沒有要先繳的錢，只提醒取貨時要付多少 */}
      {awaitingCollection && (
        <section className="mt-10 border border-cream-300 bg-white p-6">
          <h2 className="text-sm tracking-[0.1em]">{t('codTitle')}</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <InfoRow label={t('codAmount')} value={formatTWD(payment?.amount ?? order.grandTotal)} />
            {order.codFee > 0 && (
              <InfoRow label={t('codFeeLabel')} value={formatTWD(order.codFee)} />
            )}
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-taupe-600">
            {order.shipment?.cvsStoreName ? t('codHintCvs') : t('codHintHome')}
          </p>
        </section>
      )}

      {/* 匯款到公司帳戶：沒有金流商，帳號是固定那組，入帳要人工確認 */}
      {awaitingBankTransfer && (
        <section className="mt-10 border border-cream-300 bg-white p-6">
          <h2 className="text-sm tracking-[0.1em]">{t('bankTransferTitle')}</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <InfoRow label={t('bankName')} value={bankAccount.bankName} />
            <InfoRow label={t('bankCode')} value={bankAccount.bankCode} copyable />
            <InfoRow label={t('bankAccountNo')} value={bankAccount.accountNo} copyable />
            <InfoRow label={t('bankAccountName')} value={bankAccount.accountName} />
            <InfoRow label={t('transferAmount')} value={formatTWD(payment?.amount ?? order.grandTotal)} />
            <InfoRow label={t('bankDeadline')} value={payment?.expireDate ?? '—'} />
          </dl>
          {bankAccount.note && (
            <p className="mt-4 text-xs leading-relaxed text-ink-700">{bankAccount.note}</p>
          )}
          <p className="mt-2 text-xs leading-relaxed text-taupe-600">{t('bankTransferHint')}</p>
        </section>
      )}

      {/* ATM 轉帳資訊 */}
      {awaitingTransfer && payment?.vAccount && (
        <section className="mt-10 border border-cream-300 bg-white p-6">
          <h2 className="text-sm tracking-[0.1em]">{t('atmInfo')}</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <InfoRow label={t('bankCode')} value={payment.bankCode ?? '—'} />
            <InfoRow label={t('vAccount')} value={payment.vAccount} copyable />
            <InfoRow label={t('transferAmount')} value={formatTWD(payment.amount)} />
            <InfoRow label={t('expireDate')} value={payment.expireDate ?? '—'} />
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-taupe-600">{t('atmHint')}</p>
        </section>
      )}

      {/* 超商繳費資訊 */}
      {awaitingTransfer && payment?.paymentNo && (
        <section className="mt-10 border border-cream-300 bg-white p-6">
          <h2 className="text-sm tracking-[0.1em]">{t('cvsPaymentNo')}</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <InfoRow label={t('paymentCode')} value={payment.paymentNo} copyable />
            <InfoRow label={t('paymentAmount')} value={formatTWD(payment.amount)} />
            <InfoRow label={t('expireDate')} value={payment.expireDate ?? '—'} />
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-taupe-600">{t('cvsHint')}</p>
        </section>
      )}

      {/* 超商條碼：三段條碼要刷讀，只能看圖，所以直接把人帶到繳費單 */}
      {awaitingTransfer && payment?.barcode1 && (
        <section className="mt-10 border border-cream-300 bg-white p-6">
          <h2 className="text-sm tracking-[0.1em]">{t('barcodeTitle')}</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <InfoRow label={t('paymentAmount')} value={formatTWD(payment.amount)} />
            <InfoRow label={t('expireDate')} value={payment.expireDate ?? '—'} />
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-taupe-600">{t('barcodeHint')}</p>
        </section>
      )}

      {/* 繳費單：可列印、可存成圖片帶去超商（離線也看得到） */}
      {hasSlip && (
        <div className="mt-6">
          <Button asChild variant="outline">
            <Link href={`/checkout/slip?orderNo=${order.orderNo}`}>
              <Printer size={16} />
              {t('printSlip')}
            </Link>
          </Button>
          <p className="mt-2 text-xs text-taupe-500">{t('printSlipHint')}</p>
        </div>
      )}

      {/* 改用其他付款方式 */}
      {canChangePayment && (
        <PaymentSwitcher
          orderNo={order.orderNo}
          choices={switchChoices}
          currentChoice={payment?.choosePayment ?? ''}
          codFee={settings.codFee}
          needsContact={needsContact}
        />
      )}

      {/* 訂單內容 */}
      <section className="mt-10 border-t border-cream-200 pt-8">
        <h2 className="text-sm tracking-[0.1em]">{t('orderItems')}</h2>
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
          <SummaryRow label={t('subtotal')} value={formatTWD(order.subtotal)} />
          {order.discountTotal > 0 && (
            <SummaryRow
              label={t('discount')}
              value={`-${formatTWD(order.discountTotal)}`}
              tone="sale"
            />
          )}
          <SummaryRow
            label={t('shipping')}
            value={order.shippingFee === 0 ? t('freeShipping') : formatTWD(order.shippingFee)}
          />
          <div className="flex justify-between border-t border-cream-200 pt-2 text-base">
            <dt>{t('total')}</dt>
            <dd className="tabular-nums">{formatTWD(order.grandTotal)}</dd>
          </div>
        </dl>
      </section>

      {/* 配送資訊 */}
      {order.shipment && (
        <section className="mt-8 border-t border-cream-200 pt-8">
          <h2 className="text-sm tracking-[0.1em]">{t('shippingInfo')}</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <InfoRow
              label={t('shippingMethod')}
              value={tLogistics(order.shipment.logisticsSubType)}
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
            <InfoRow label={t('receiver')} value={order.shipment.receiverName} />
            {order.shipment.cvsStoreName ? (
              <>
                <InfoRow label={t('cvsStore')} value={order.shipment.cvsStoreName} />
                <InfoRow label={t('cvsStoreAddress')} value={order.shipment.cvsAddress ?? '—'} />
              </>
            ) : (
              <InfoRow label={t('receiverAddress')} value={order.shipment.receiverAddress ?? '—'} />
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
              {t('trackAt', { carrier: tLogistics(order.shipment.logisticsSubType) })}
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

      {/* 退款：已經有在處理的申請就顯示進度，否則顯示申請入口 */}
      {openRefund ? (
        <section className="mt-8 border border-cream-300 bg-white p-6">
          <h2 className="text-sm tracking-[0.1em]">{t('refundInProgressTitle')}</h2>
          <p className="mt-2 text-sm text-ink-700">
            {openRefund.status === 'APPROVED'
              ? t('refundApprovedHint')
              : t('refundRequestedHint')}
          </p>
        </section>
      ) : (
        refund.eligible && <RefundContact orderNo={order.orderNo} />
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
