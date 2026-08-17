import Link from 'next/link'
import type { OrderStatus, Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { formatTWD } from '@/lib/utils'
import { ORDER_STATUS_LABEL } from '@/lib/orders/labels'
import { PageHeader, DataTable, Td, AdminPagination } from '@/components/admin/ui'
import { Badge, ORDER_STATUS_TONE } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { pendingTcatParcelCount, todayPickupCall } from '@/lib/orders/tcat-pickup'
import { PickupButton } from './pickup-button'

export const dynamic = 'force-dynamic'
export const metadata = { title: '訂單' }

const PER_PAGE = 30

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '', label: '全部' },
  ...Object.entries(ORDER_STATUS_LABEL).map(([value, label]) => ({ value, label })),
]

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>
}) {
  const sp = await searchParams
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1)

  const where: Prisma.OrderWhereInput = {}
  if (sp.status && sp.status in ORDER_STATUS_LABEL) {
    where.status = sp.status as OrderStatus
  }
  if (sp.q?.trim()) {
    const q = sp.q.trim()
    where.OR = [
      { orderNo: { contains: q, mode: 'insensitive' } },
      { recipientName: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { phone: { contains: q } },
    ]
  }

  const [orders, total, pendingParcels, pickupCall] = await Promise.all([
    db.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: {
        payment: { select: { status: true } },
        shipment: { select: { status: true } },
        _count: { select: { items: true } },
      },
    }),
    db.order.count({ where }),
    pendingTcatParcelCount(),
    todayPickupCall(),
  ])

  return (
    <>
      <PageHeader
        title="訂單"
        description={`共 ${total} 筆`}
        // 叫車是「今天倉庫要交寄」的動作，不屬於任何一張訂單，所以放在列表頁而不是訂單頁
        action={
          <PickupButton
            pendingCount={pendingParcels}
            calledToday={
              pickupCall
                ? {
                    quantity: pickupCall.quantity,
                    message: pickupCall.message,
                    createdAt: pickupCall.createdAt,
                  }
                : null
            }
          />
        }
      />

      <div className="mb-5 space-y-4">
        <form method="get" className="flex gap-2">
          {sp.status && <input type="hidden" name="status" value={sp.status} />}
          <input
            name="q"
            defaultValue={sp.q ?? ''}
            placeholder="搜尋訂單編號、收件人、Email 或手機"
            className="w-full max-w-sm border border-cream-300 bg-white px-3 py-2 text-sm focus:border-taupe-500 focus:outline-none"
          />
          <button
            type="submit"
            className="border border-ink-900 px-4 py-2 text-sm text-ink-900 transition-colors hover:bg-ink-900 hover:text-cream-50"
          >
            搜尋
          </button>
        </form>

        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((filter) => {
            const params = new URLSearchParams()
            if (filter.value) params.set('status', filter.value)
            if (sp.q) params.set('q', sp.q)
            const qs = params.toString()
            const active = (sp.status ?? '') === filter.value
            return (
              <Link
                key={filter.value || 'all'}
                href={qs ? `/admin/orders?${qs}` : '/admin/orders'}
                className={cn(
                  'border px-3 py-1.5 text-xs transition-colors',
                  active
                    ? 'border-ink-900 bg-ink-900 text-cream-50'
                    : 'border-cream-300 text-ink-700 hover:border-taupe-400',
                )}
              >
                {filter.label}
              </Link>
            )
          })}
        </div>
      </div>

      <DataTable
        headers={['訂單編號', '收件人', '品項', '金額', '訂單狀態', '成立時間']}
        empty={orders.length === 0}
      >
        {orders.map((order) => (
          <tr key={order.id} className="hover:bg-cream-50">
            <Td>
              <Link
                href={`/admin/orders/${order.id}`}
                className="tabular-nums text-ink-900 underline underline-offset-4"
              >
                {order.orderNo}
              </Link>
            </Td>
            <Td>
              <div>{order.recipientName}</div>
              <div className="text-xs text-taupe-500">{order.phone}</div>
            </Td>
            <Td className="tabular-nums text-taupe-600">{order._count.items}</Td>
            <Td className="tabular-nums">{formatTWD(order.grandTotal)}</Td>
            <Td>
              <Badge tone={ORDER_STATUS_TONE[order.status]}>
                {ORDER_STATUS_LABEL[order.status]}
              </Badge>
            </Td>
            <Td className="whitespace-nowrap text-xs text-taupe-500">
              {order.createdAt.toLocaleString('zh-TW', { hour12: false })}
            </Td>
          </tr>
        ))}
      </DataTable>

      <AdminPagination
        page={page}
        totalPages={Math.max(1, Math.ceil(total / PER_PAGE))}
        basePath="/admin/orders"
        searchParams={sp}
      />
    </>
  )
}
