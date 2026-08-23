import Link from 'next/link'
import type { OrderStatus, Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { formatTWD } from '@/lib/utils'
import {
  CHOOSE_PAYMENT_LABEL,
  ORDER_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
} from '@/lib/orders/labels'
import {
  PageHeader,
  DataTable,
  Td,
  AdminPagination,
  FilterChips,
  SearchForm,
} from '@/components/admin/ui'
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

/**
 * 「客戶到底付款了沒」的快篩。
 *
 * 訂單狀態不等於收款狀態 —— 貨到付款的訂單一成立就是備貨中，錢卻是取貨時才收；
 * 待付款的訂單也分「還沒去繳」與「已取號等繳費」。這一排就是為了讓這件事一眼可見。
 */
const PAYMENT_FILTERS: { value: string; label: string; where: Prisma.OrderWhereInput }[] = [
  { value: '', label: '全部', where: {} },
  {
    value: 'paid',
    label: '已收款',
    where: { payments: { some: { status: 'PAID' } } },
  },
  {
    value: 'unpaid',
    label: '未收款',
    where: {
      status: { in: ['PENDING_PAYMENT', 'PROCESSING'] },
      payments: { none: { status: 'PAID' } },
    },
  },
  {
    value: 'awaiting',
    label: '已取號待繳費',
    where: {
      payments: {
        some: { supersededAt: null, provider: 'ECPAY', status: 'AWAITING_TRANSFER' },
      },
    },
  },
  {
    // 匯款沒有任何自動入帳通知，這份清單就是每天要拿去對帳戶的那疊
    value: 'bank',
    label: '匯款待入帳',
    where: {
      payments: { some: { supersededAt: null, provider: 'BANK', status: 'AWAITING_TRANSFER' } },
    },
  },
  {
    value: 'cod',
    label: '貨到付款待收',
    where: { payments: { some: { supersededAt: null, status: 'AWAITING_COLLECTION' } } },
  },
]

/** 三組快篩共用一份網址組法：換其中一個條件，其他兩個要留著。 */
function ordersHref(params: Record<string, string | undefined>) {
  const qs = new URLSearchParams(
    Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])),
  ).toString()
  return qs ? `/admin/orders?${qs}` : '/admin/orders'
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; payment?: string; q?: string; page?: string }>
}) {
  const sp = await searchParams
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1)

  const where: Prisma.OrderWhereInput = {}
  if (sp.status && sp.status in ORDER_STATUS_LABEL) {
    where.status = sp.status as OrderStatus
  }
  const paymentFilter = PAYMENT_FILTERS.find((f) => f.value && f.value === sp.payment)
  if (paymentFilter) Object.assign(where, paymentFilter.where)

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
        // 只取目前生效的那筆付款（改過付款方式的訂單會有多筆）
        payments: {
          where: { supersededAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { status: true, choosePayment: true, expireDate: true },
        },
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

      <div className="mb-5 space-y-3">
        <SearchForm
          defaultValue={sp.q}
          placeholder="搜尋訂單編號、收件人、Email 或手機"
          width="sm:w-96"
          hidden={{ status: sp.status, payment: sp.payment }}
        />

        <FilterChips
          active={sp.status ?? ''}
          items={STATUS_FILTERS.map((filter) => ({
            ...filter,
            href: ordersHref({ status: filter.value, payment: sp.payment, q: sp.q }),
          }))}
        />

        <FilterChips
          label="收款狀態"
          active={sp.payment ?? ''}
          items={PAYMENT_FILTERS.map((filter) => ({
            value: filter.value,
            label: filter.label,
            href: ordersHref({ status: sp.status, payment: filter.value, q: sp.q }),
          }))}
        />
      </div>

      <DataTable
        headers={['訂單編號', '收件人', '品項', '金額', '收款', '訂單狀態', '成立時間']}
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
              {order.payments[0] ? (
                <>
                  <div
                    className={cn(
                      'text-xs',
                      order.payments[0].status === 'PAID' ? 'text-ink-900' : 'text-sale',
                    )}
                  >
                    {PAYMENT_STATUS_LABEL[order.payments[0].status]}
                  </div>
                  <div className="mt-0.5 text-xs text-taupe-500">
                    {CHOOSE_PAYMENT_LABEL[order.payments[0].choosePayment] ??
                      order.payments[0].choosePayment}
                    {order.payments[0].status === 'AWAITING_TRANSFER' &&
                      order.payments[0].expireDate &&
                      ` ・ 期限 ${order.payments[0].expireDate}`}
                  </div>
                </>
              ) : (
                <span className="text-xs text-taupe-500">—</span>
              )}
            </Td>
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
