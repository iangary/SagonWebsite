import Image from 'next/image'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/routing'
import type { Order, OrderItem, Payment, Shipment, Invoice } from '@prisma/client'
import { Badge, ORDER_STATUS_TONE, SHIPMENT_STATUS_TONE } from '@/components/ui/badge'
import { formatTWD } from '@/lib/utils'
import { LOGISTICS_SUBTYPE_LABEL, shipmentStatusKey } from '@/lib/ecpay/logistics'

type OrderWithDetails = Order & {
  items: OrderItem[]
  payment: Payment | null
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
  const [tStatus, tShipment, tResult] = await Promise.all([
    getTranslations('orderStatus'),
    getTranslations('shipmentStatus'),
    getTranslations('result'),
  ])

  const awaitingTransfer = order.payment?.status === 'AWAITING_TRANSFER'

  // 已取號的 ATM／超商不給重新付款 —— 重送一次會產生新的虛擬帳號，
  // 客戶手上就有兩組號碼了。訂單一旦離開 PENDING_PAYMENT，那支路由本身也會擋。
  const canRetryPayment = order.status === 'PENDING_PAYMENT' && !awaitingTransfer

  return (
    <article className="border border-cream-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cream-200 px-5 py-3.5">
        <div>
          <p className="text-sm tabular-nums text-ink-900">{order.orderNo}</p>
          <p className="mt-0.5 text-xs text-taupe-500">
            {order.createdAt.toLocaleString('zh-TW', { hour12: false })}
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
              配送：{LOGISTICS_SUBTYPE_LABEL[order.shipment.logisticsSubType]}
              {order.shipment.cvsStoreName && ` ・ ${order.shipment.cvsStoreName}`}
              {order.shipment.shipmentNo && ` ・ 單號 ${order.shipment.shipmentNo}`}
            </span>
            <Badge tone={SHIPMENT_STATUS_TONE[order.shipment.status]}>
              {tShipment(
                shipmentStatusKey(order.shipment.status, order.shipment.logisticsSubType),
              )}
            </Badge>
          </div>
        )}
        {order.invoice?.invoiceNumber && <p>發票號碼：{order.invoice.invoiceNumber}</p>}
        {awaitingTransfer && order.payment?.vAccount && (
          <p className="text-sale">
            待轉帳：{order.payment.bankCode} / {order.payment.vAccount}
            （期限 {order.payment.expireDate}）
          </p>
        )}
        {awaitingTransfer && order.payment?.paymentNo && (
          <p className="text-sale">
            待繳費代碼：{order.payment.paymentNo}（期限 {order.payment.expireDate}）
          </p>
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-cream-200 px-5 py-3.5">
        <span className="text-sm">
          合計 <span className="text-base tabular-nums">{formatTWD(order.grandTotal)}</span>
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
          <Link
            href={`/checkout/result?orderNo=${order.orderNo}`}
            className="text-ink-900 underline underline-offset-4"
          >
            訂單明細
          </Link>
          {showReviewLink && order.status === 'COMPLETED' && (
            <Link
              href={`/account/orders/${order.id}/review`}
              className="text-ink-900 underline underline-offset-4"
            >
              撰寫評論
            </Link>
          )}
        </div>
      </footer>
    </article>
  )
}
