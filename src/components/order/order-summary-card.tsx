import Image from 'next/image'
import { getLocale, getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/routing'
import type { Order, OrderItem, Payment, Shipment, Invoice } from '@prisma/client'
import { Badge, ORDER_STATUS_TONE, SHIPMENT_STATUS_TONE } from '@/components/ui/badge'
import { formatTWD } from '@/lib/utils'
import { shipmentStatusKey } from '@/lib/ecpay/logistics'
import { currentPaymentOf } from '@/lib/orders/payment'

type OrderWithDetails = Order & {
  items: OrderItem[]
  /** 一張訂單可能有多筆付款（改過付款方式），顯示目前生效的那筆 */
  payments: Payment[]
  shipment: Shipment | null
  invoice: Invoice | null
}

/**
 * 訂單卡片。會員中心與訪客訂單查詢共用同一個元件，
 * 兩邊看到的資訊格式才會一致。
 */
export async function OrderSummaryCard({
  order,
  showReviewLink = false,
}: {
  order: OrderWithDetails
  showReviewLink?: boolean
}) {
  const [tStatus, tShipment, tResult, tLogistics, tProduct, locale] = await Promise.all([
    getTranslations('orderStatus'),
    getTranslations('shipmentStatus'),
    getTranslations('result'),
    getTranslations('logistics'),
    getTranslations('product'),
    getLocale(),
  ])
  const tCommon = await getTranslations('common')

  const payment = currentPaymentOf(order.payments)
  const awaitingTransfer = payment?.status === 'AWAITING_TRANSFER'
  const awaitingCollection = payment?.status === 'AWAITING_COLLECTION'

  // 已取號的 ATM／超商不給重新付款 —— 重送一次會產生新的虛擬帳號，
  // 客戶手上就有兩組號碼了。訂單一旦離開 PENDING_PAYMENT，那支路由本身也會擋。
  const canRetryPayment = order.status === 'PENDING_PAYMENT' && !awaitingTransfer

  return (
    <article className="border border-cream-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cream-200 px-5 py-3.5">
        <div>
          <p className="text-sm tabular-nums text-ink-900">{order.orderNo}</p>
          <p className="mt-0.5 text-xs text-taupe-500">
            {order.createdAt.toLocaleString(locale, { hour12: false })}
          </p>
        </div>
        <Badge tone={ORDER_STATUS_TONE[order.status]}>{tStatus(order.status)}</Badge>
      </header>

      <ul className="divide-y divide-cream-100 px-5">
        {order.items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 py-3.5">
            <div className="relative size-14 shrink-0 overflow-hidden bg-cream-100">
              {item.imageUrl && (
                <Image src={item.imageUrl} alt="" fill sizes="56px" className="object-cover" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-1 text-sm text-ink-900">{item.productName}</p>
              <p className="mt-0.5 text-xs text-taupe-500">
                {item.variantName} × {item.qty}
              </p>
            </div>
            <span className="shrink-0 text-sm tabular-nums text-ink-700">
              {formatTWD(item.lineTotal)}
            </span>
          </li>
        ))}
      </ul>

      <div className="space-y-1.5 border-t border-cream-200 px-5 py-3.5 text-xs text-taupe-600">
        {order.shipment && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <span>
              {tResult('shipmentLabel')}
              {tCommon('colon')}
              {tLogistics(order.shipment.logisticsSubType)}
              {order.shipment.cvsStoreName && ` ・ ${order.shipment.cvsStoreName}`}
              {order.shipment.shipmentNo &&
                ` ・ ${tResult('shipmentNoShort')} ${order.shipment.shipmentNo}`}
            </span>
            <Badge tone={SHIPMENT_STATUS_TONE[order.shipment.status]}>
              {tShipment(
                shipmentStatusKey(order.shipment.status, order.shipment.logisticsSubType),
              )}
            </Badge>
          </div>
        )}
        {order.invoice?.invoiceNumber && (
          <p>
            {tResult('invoiceNumber')}
            {tCommon('colon')}
            {order.invoice.invoiceNumber}
          </p>
        )}
        {/* 匯款：帳號在訂單明細頁（那裡才讀得到設定），這裡只提醒還沒匯與期限 */}
        {awaitingTransfer && payment?.provider === 'BANK' && (
          <p className="text-sale">
            {tResult('awaitingBankTransfer', {
              amount: formatTWD(payment.amount),
              expireDate: payment.expireDate ?? '—',
            })}
          </p>
        )}
        {awaitingTransfer && payment?.vAccount && (
          <p className="text-sale">
            {tResult('awaitingTransfer', {
              bankCode: payment.bankCode ?? '—',
              vAccount: payment.vAccount,
              expireDate: payment.expireDate ?? '—',
            })}
          </p>
        )}
        {awaitingTransfer && payment?.paymentNo && (
          <p className="text-sale">
            {tResult('awaitingPaymentCode', {
              paymentNo: payment.paymentNo,
              expireDate: payment.expireDate ?? '—',
            })}
          </p>
        )}
        {awaitingCollection && (
          <p className="text-ink-700">
            {tResult('awaitingCollection', { amount: formatTWD(order.grandTotal) })}
          </p>
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-cream-200 px-5 py-3.5">
        <span className="text-sm">
          {tResult('grandTotal')}{' '}
          <span className="text-base tabular-nums">{formatTWD(order.grandTotal)}</span>
        </span>
        <div className="flex gap-3 text-xs">
          {canRetryPayment && (
            // 原生 <a>：/api/* 在 locale 路由之外，用 next-intl 的 Link 會被加上語系前綴而 404
            <a
              href={`/api/ecpay/payment/checkout/${order.orderNo}`}
              className="text-sale underline underline-offset-4"
            >
              {tResult('retryPayment')}
            </a>
          )}
          {awaitingTransfer && (payment?.paymentNo || payment?.barcode1 || payment?.vAccount) && (
            <Link
              href={`/checkout/slip?orderNo=${order.orderNo}`}
              className="text-ink-900 underline underline-offset-4"
            >
              {tResult('printSlip')}
            </Link>
          )}
          <Link
            href={`/checkout/result?orderNo=${order.orderNo}`}
            className="text-ink-900 underline underline-offset-4"
          >
            {tResult('orderDetail')}
          </Link>
          {showReviewLink && order.status === 'COMPLETED' && (
            <Link
              href={`/account/orders/${order.id}/review`}
              className="text-ink-900 underline underline-offset-4"
            >
              {tProduct('writeReview')}
            </Link>
          )}
        </div>
      </footer>
    </article>
  )
}
