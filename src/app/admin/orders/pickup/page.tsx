import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@/components/admin/ui'
import { SHIPMENT_STATUS_LABEL } from '@/lib/orders/labels'
import {
  listPendingTcatParcels,
  listRecentPickupCalls,
  pickupDateToday,
} from '@/lib/orders/tcat-pickup'
import { PickupForm } from './pickup-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: '呼叫黑貓收貨' }

/**
 * 呼叫黑貓收貨：勾選這一趟要交寄的訂單。
 *
 * 黑貓的 Call API 只收件數，所以「指定訂單」是我們這邊的事 ——
 * 件數照勾選數送、單號寫進備註，成功後在資料庫記下這趟收了哪幾張。
 */
export default async function PickupPage() {
  const [parcels, history] = await Promise.all([listPendingTcatParcels(), listRecentPickupCalls()])

  const today = pickupDateToday()
  const calledToday = history.find((call) => call.succeededDate === today) ?? null

  return (
    <>
      <Link
        href="/admin/orders"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-taupe-600 hover:text-ink-900"
      >
        <ArrowLeft size={14} />
        回訂單列表
      </Link>

      <PageHeader
        title="呼叫黑貓收貨"
        description="勾選這一趟要交給司機的包裹。每個收貨點一天只能叫一次、不能指定時段，司機依當日路線過來（週一至五 08:00–16:30、週六 08:00–15:30）。"
      />

      {calledToday ? (
        <section className="mb-8 border border-cream-200 bg-white p-5 text-sm">
          <h2 className="mb-2 tracking-[0.1em] text-ink-900">今天已經呼叫過黑貓</h2>
          <p className="text-taupe-600">
            {calledToday.createdAt.toLocaleTimeString('zh-TW', { hour12: false })} 送出，共{' '}
            {calledToday.quantity} 件。黑貓一天只受理一次，還有急件請直接電洽 412-8888。
          </p>
          {calledToday.message && <p className="mt-2 text-ink-700">{calledToday.message}</p>}
        </section>
      ) : (
        <PickupForm
          parcels={parcels.map((p) => ({
            id: p.id,
            orderId: p.order.id,
            orderNo: p.order.orderNo,
            shipmentNo: p.shipmentNo ?? '',
            receiverName: p.receiverName,
            receiverAddress: p.receiverAddress ?? '',
            hasLabel: Boolean(p.labelPath),
            createdAt: p.createdAt.toLocaleString('zh-TW', { hour12: false }),
          }))}
        />
      )}

      <section className="mt-10">
        <h2 className="mb-3 text-sm tracking-[0.1em] text-ink-900">最近的叫車紀錄</h2>
        {history.length === 0 ? (
          <p className="text-sm text-taupe-500">還沒有叫車紀錄</p>
        ) : (
          <ul className="divide-y divide-cream-200 border border-cream-200 bg-white">
            {history.map((call) => (
              <li key={call.id} className="p-4 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="tabular-nums text-ink-900">
                    {call.createdAt.toLocaleString('zh-TW', { hour12: false })} ・ {call.quantity} 件
                  </span>
                  <span className={call.succeededDate ? 'text-xs text-taupe-600' : 'text-xs text-sale'}>
                    {call.succeededDate ? '已送出' : '失敗'}
                    {call.requestedBy && ` ・ ${call.requestedBy.name ?? call.requestedBy.email}`}
                  </span>
                </div>
                {call.message && (
                  <p className={`mt-1 text-xs ${call.succeededDate ? 'text-taupe-600' : 'text-sale'}`}>
                    {call.message}
                  </p>
                )}
                {call.shipments.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    {call.shipments.map((s) => (
                      <li key={s.id}>
                        <Link
                          href={`/admin/orders/${s.order.id}`}
                          className="tabular-nums text-ink-900 underline underline-offset-4"
                        >
                          {s.order.orderNo}
                        </Link>
                        <span className="ml-1 text-taupe-500">
                          {s.shipmentNo} ・ {SHIPMENT_STATUS_LABEL[s.status]}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
