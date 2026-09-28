import Image from 'next/image'
import { getFormatter, getTranslations } from 'next-intl/server'
import { Clock } from 'lucide-react'
import type { Order, OrderItem, Payment } from '@prisma/client'
import { Link } from '@/i18n/routing'
import { Button } from '@/components/ui/button'
import { formatTWD } from '@/lib/utils'
import { currentPaymentOf } from '@/lib/orders/payment'

export type PendingOrder = Order & {
  items: OrderItem[]
  payments: Payment[]
  /** 還沒釋放、也還沒轉實扣的預扣 —— 最早到期的那筆就是商品保留期限 */
  reservations: { expiresAt: Date }[]
}

/**
 * 購物車頁上方的「還沒付款的訂單」。
 *
 * 下單當下購物車就清空了，客戶關掉綠界頁或還沒去匯款，回來只看到空車，
 * 很容易以為沒買成功而重下一張，或乾脆忘了付 —— 所以回到購物車時要提醒。
 */
export async function PendingOrders({ orders }: { orders: PendingOrder[] }) {
  if (orders.length === 0) return null

  const [t, format] = await Promise.all([getTranslations('cart'), getFormatter()])

  return (
    <section
      aria-labelledby="pending-orders-title"
      className="border border-rose-accent/60 bg-white"
    >
      <header className="flex items-start gap-3 border-b border-cream-200 px-5 py-4">
        <Clock size={18} strokeWidth={1.5} className="mt-0.5 shrink-0 text-sale" />
        <div>
          <h2 id="pending-orders-title" className="text-sm text-ink-900">
            {t('pendingTitle', { count: orders.length })}
          </h2>
          <p className="mt-1 text-xs text-taupe-600">{t('pendingNote')}</p>
        </div>
      </header>

      <ul className="divide-y divide-cream-100">
        {orders.map((order) => {
          const payment = currentPaymentOf(order.payments)
          const awaitingTransfer = payment?.status === 'AWAITING_TRANSFER'
          // 已取號的 ATM／超商／匯款不能再送一次收銀台（會產生第二組代碼），改去明細頁看繳費資訊
          const canRetryPayment = !awaitingTransfer
          const holdUntil = order.reservations.reduce<Date | null>(
            (min, r) => (!min || r.expiresAt < min ? r.expiresAt : min),
            null,
          )
          const qty = order.items.reduce((sum, item) => sum + item.qty, 0)

          const deadline =
            awaitingTransfer && payment?.expireDate
              ? t('pendingPayBy', { deadline: payment.expireDate })
              : holdUntil
                ? t('pendingHoldUntil', {
                    deadline: format.dateTime(holdUntil, {
                      month: 'numeric',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    }),
                  })
                : null

          return (
            <li key={order.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
              <div className="relative size-14 shrink-0 overflow-hidden bg-cream-100">
                {order.items[0]?.imageUrl && (
                  <Image
                    src={order.items[0].imageUrl}
                    alt=""
                    fill
                    sizes="56px"
                    className="object-cover"
                  />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-sm tabular-nums text-ink-900">
                  {order.orderNo}
                  <span className="ml-2 text-xs text-taupe-500">
                    {t('pendingItems', { count: qty })}
                  </span>
                </p>
                {deadline && <p className="mt-0.5 text-xs text-sale">{deadline}</p>}
              </div>

              <div className="flex w-full items-center justify-between gap-4 sm:w-auto sm:justify-end">
                <span className="text-sm tabular-nums text-ink-900">
                  {formatTWD(order.grandTotal)}
                </span>
                <div className="flex items-center gap-3 text-xs">
                  <Link
                    href={`/checkout/result?orderNo=${order.orderNo}`}
                    className="text-taupe-600 underline underline-offset-4 hover:text-ink-900"
                  >
                    {canRetryPayment ? t('pendingDetail') : t('pendingViewPayment')}
                  </Link>
                  {canRetryPayment && (
                    // 原生 <a>：/api/* 在 locale 路由之外，用 next-intl 的 Link 會被加上語系前綴而 404。
                    // 非綠界（貨到付款等）那支路由會自己導回明細頁。
                    <Button asChild size="sm">
                      <a href={`/api/ecpay/payment/checkout/${order.orderNo}`}>{t('pendingPay')}</a>
                    </Button>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
