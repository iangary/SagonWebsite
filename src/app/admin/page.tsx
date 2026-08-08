import Link from 'next/link'
import { db } from '@/lib/db'
import { formatTWD } from '@/lib/utils'
import { PageHeader, StatCard, DataTable, Td } from '@/components/admin/ui'
import { Badge, ORDER_STATUS_TONE } from '@/components/ui/badge'

export const dynamic = 'force-dynamic'

const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: '待付款',
  PAID: '已付款',
  PROCESSING: '備貨中',
  SHIPPED: '已出貨',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  REFUNDED: '已退款',
}

const LOW_STOCK_THRESHOLD = 3

export default async function AdminDashboard() {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)

  const [todayRevenue, todayOrders, pendingPayment, toShip, lowStock, failedWebhooks, recentOrders] =
    await Promise.all([
      db.order.aggregate({
        where: { paidAt: { gte: startOfToday } },
        _sum: { grandTotal: true },
      }),
      db.order.count({ where: { createdAt: { gte: startOfToday } } }),
      db.order.count({ where: { status: 'PENDING_PAYMENT' } }),
      db.order.count({ where: { status: { in: ['PAID', 'PROCESSING'] } } }),
      db.productVariant.count({
        where: { isActive: true, stock: { lte: LOW_STOCK_THRESHOLD } },
      }),
      db.webhookEvent.count({ where: { processedAt: null } }),
      db.order.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          orderNo: true,
          status: true,
          grandTotal: true,
          recipientName: true,
          createdAt: true,
        },
      }),
    ])

  return (
    <>
      <PageHeader title="總覽" description="今日營運概況" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="今日營收"
          value={formatTWD(todayRevenue._sum.grandTotal ?? 0)}
          hint="以付款完成時間計算"
        />
        <StatCard label="今日訂單" value={todayOrders} hint="含未付款" />
        <StatCard label="待付款" value={pendingPayment} hint="逾期會自動取消" />
        <StatCard label="待出貨" value={toShip} hint="已付款與備貨中" />
        <StatCard
          label={`低庫存（≤ ${LOW_STOCK_THRESHOLD}）`}
          value={lowStock}
          tone={lowStock > 0 ? 'alert' : undefined}
          hint="需要補貨的規格數"
        />
        <StatCard
          label="未處理 Webhook"
          value={failedWebhooks}
          tone={failedWebhooks > 0 ? 'alert' : undefined}
          hint={failedWebhooks > 0 ? '請至 Webhook 頁面查看' : '一切正常'}
        />
      </div>

      <section className="mt-10">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base tracking-[0.1em]">最新訂單</h2>
          <Link href="/admin/orders" className="text-xs text-taupe-600 underline underline-offset-4">
            查看全部
          </Link>
        </div>

        <DataTable
          headers={['訂單編號', '收件人', '狀態', '金額', '成立時間']}
          empty={recentOrders.length === 0}
        >
          {recentOrders.map((order) => (
            <tr key={order.id} className="hover:bg-cream-50">
              <Td>
                <Link
                  href={`/admin/orders/${order.id}`}
                  className="tabular-nums text-ink-900 underline underline-offset-4"
                >
                  {order.orderNo}
                </Link>
              </Td>
              <Td>{order.recipientName}</Td>
              <Td>
                <Badge tone={ORDER_STATUS_TONE[order.status]}>
                  {ORDER_STATUS_LABEL[order.status]}
                </Badge>
              </Td>
              <Td className="tabular-nums">{formatTWD(order.grandTotal)}</Td>
              <Td className="whitespace-nowrap text-xs text-taupe-500">
                {order.createdAt.toLocaleString('zh-TW', { hour12: false })}
              </Td>
            </tr>
          ))}
        </DataTable>
      </section>
    </>
  )
}
