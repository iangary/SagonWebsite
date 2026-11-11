import Image from 'next/image'
import Link from 'next/link'
import type { OrderStatus, PaymentStatus, Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { formatTWD } from '@/lib/utils'
import {
  CHOOSE_PAYMENT_LABEL,
  ORDER_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  SHIPMENT_STATUS_LABEL,
} from '@/lib/orders/labels'
import { formatOrderTime } from '@/lib/orders/format-time'
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
import { StatusTabsScroller } from './status-tabs-scroller'

export const dynamic = 'force-dynamic'
export const metadata = { title: '訂單' }

const PER_PAGE = 30

/**
 * 「待處理」：店家現在要動手的訂單。打開訂單頁預設就是這一頁 ——
 * 已完成、已取消的單佔了列表大半，混在一起就得一張張找哪些還沒出貨。
 *
 *   已付款、備貨中   → 要出貨（物流建單失敗的也在這裡面，卡片上另外標紅字）
 *   匯款待入帳       → 要去對帳戶（匯款沒有自動入帳通知）
 *   退款待審核       → 要審核
 */
const TODO_WHERE: Prisma.OrderWhereInput = {
  OR: [
    { status: { in: ['PAID', 'PROCESSING'] } },
    {
      status: 'PENDING_PAYMENT',
      payments: { some: { supersededAt: null, provider: 'BANK', status: 'AWAITING_TRANSFER' } },
    },
    { refunds: { some: { status: 'REQUESTED' } } },
  ],
}

/** 頁籤順序就是處理順序：先看要動手的，再依訂單生命週期排 */
const STATUS_TABS: { value: string; label: string }[] = [
  { value: 'todo', label: '待處理' },
  { value: 'all', label: '全部' },
  ...(['PENDING_PAYMENT', 'PAID', 'PROCESSING', 'SHIPPED', 'COMPLETED', 'CANCELLED', 'REFUNDED'] as const).map(
    (value) => ({ value, label: ORDER_STATUS_LABEL[value] }),
  ),
]

/**
 * 「客戶到底付款了沒」的快篩。
 *
 * 訂單狀態不等於收款狀態 —— 貨到付款的訂單一成立就是備貨中，錢卻是取貨時才收；
 * 待付款的訂單也分「還沒去繳」與「已取號等繳費」。平常用不到，收在「更多篩選」裡。
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

/** 三組條件共用一份網址組法：換其中一個條件，其他的要留著。 */
function ordersHref(params: Record<string, string | undefined>) {
  const qs = new URLSearchParams(
    Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])),
  ).toString()
  return qs ? `/admin/orders?${qs}` : '/admin/orders'
}

/**
 * 收款欄的文字與顏色。
 * 已取消的訂單不顯示付款紀錄本身的「已逾期／已作廢」—— 看起來像出了錯，
 * 店家要知道的只是「沒收到錢、單已取消」。
 */
function paymentSummary(
  orderStatus: OrderStatus,
  payment: { status: PaymentStatus; choosePayment: string; expireDate: string | null } | undefined,
): { text: string; tone: 'ok' | 'alert' | 'muted'; method: string | null } {
  if (!payment) return { text: '—', tone: 'muted', method: null }
  const method = CHOOSE_PAYMENT_LABEL[payment.choosePayment] ?? payment.choosePayment
  if (payment.status === 'PAID') return { text: '已收款', tone: 'ok', method }
  if (orderStatus === 'CANCELLED') return { text: '未付款・已取消', tone: 'muted', method }
  if (payment.status === 'REFUNDED') return { text: '已退款', tone: 'muted', method }
  const deadline =
    payment.status === 'AWAITING_TRANSFER' && payment.expireDate ? `（期限 ${payment.expireDate}）` : ''
  return { text: `${PAYMENT_STATUS_LABEL[payment.status]}${deadline}`, tone: 'alert', method }
}

const PAYMENT_TONE_CLASS = { ok: 'text-ink-900', alert: 'text-sale', muted: 'text-taupe-500' }

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; payment?: string; q?: string; page?: string }>
}) {
  const sp = await searchParams
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1)
  const paymentFilter = PAYMENT_FILTERS.find((f) => f.value && f.value === sp.payment)

  // 沒指定狀態時打開「待處理」；但搜尋或用了收款篩選時要找的是特定訂單，改看全部
  const status =
    sp.status && STATUS_TABS.some((t) => t.value === sp.status)
      ? sp.status
      : sp.q?.trim() || paymentFilter
        ? 'all'
        : 'todo'

  const where: Prisma.OrderWhereInput = { AND: [] }
  const and = where.AND as Prisma.OrderWhereInput[]
  if (status === 'todo') and.push(TODO_WHERE)
  else if (status in ORDER_STATUS_LABEL) and.push({ status: status as OrderStatus })
  if (paymentFilter) and.push(paymentFilter.where)
  if (sp.q?.trim()) {
    const q = sp.q.trim()
    and.push({
      OR: [
        { orderNo: { contains: q, mode: 'insensitive' } },
        { recipientName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
      ],
    })
  }

  const [orders, total, statusCounts, todoCount, allCount, pendingParcels, pickupCall] =
    await Promise.all([
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
          shipment: { select: { status: true, shipmentNo: true, logisticsSubType: true } },
          // 一張單通常一兩件，整批取回來：列表要秀第一件的名稱與圖、總件數、有沒有預購
          items: {
            orderBy: { id: 'asc' },
            select: { productName: true, variantName: true, imageUrl: true, qty: true, isPreorder: true },
          },
          refunds: { where: { status: 'REQUESTED' }, select: { id: true }, take: 1 },
        },
      }),
      db.order.count({ where }),
      db.order.groupBy({ by: ['status'], _count: { _all: true } }),
      db.order.count({ where: TODO_WHERE }),
      db.order.count(),
      pendingTcatParcelCount(),
      todayPickupCall(),
    ])

  const countByStatus = new Map(statusCounts.map((row) => [row.status as string, row._count._all]))
  const tabCount = (value: string) =>
    value === 'todo' ? todoCount : value === 'all' ? allCount : (countByStatus.get(value) ?? 0)

  const rows = orders.map((order) => {
    const first = order.items[0]
    const qty = order.items.reduce((n, item) => n + item.qty, 0)
    return {
      order,
      first,
      qty,
      hasPreorder: order.items.some((item) => item.isPreorder),
      refundRequested: order.refunds.length > 0,
      payment: paymentSummary(order.status, order.payments[0]),
      time: formatOrderTime(order.createdAt),
      href: `/admin/orders/${order.id}`,
    }
  })

  return (
    <>
      <PageHeader
        title="訂單"
        description={`共 ${allCount} 筆`}
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

        {/* 手機上一排橫滑，不換行 —— 換行的話光篩選就佔掉半個螢幕 */}
        <StatusTabsScroller className="relative -mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
          <ul className="flex gap-2 sm:flex-wrap">
            {STATUS_TABS.map((tab) => {
              const active = status === tab.value
              const count = tabCount(tab.value)
              return (
                <li key={tab.value} className="shrink-0">
                  <Link
                    href={ordersHref({ status: tab.value, payment: sp.payment, q: sp.q })}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap border px-3 text-xs transition-colors sm:min-h-8',
                      active
                        ? 'border-ink-900 bg-ink-900 text-cream-50'
                        : 'border-cream-300 text-ink-700 hover:border-taupe-400',
                    )}
                  >
                    {tab.label}
                    <span
                      className={cn(
                        'tabular-nums',
                        active
                          ? 'text-cream-200'
                          : tab.value === 'todo' && count > 0
                            ? 'font-medium text-sale'
                            : 'text-taupe-500',
                      )}
                    >
                      {count}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </StatusTabsScroller>

        <details className="group" open={Boolean(paymentFilter)}>
          <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-1 text-xs text-taupe-600 hover:text-ink-900 sm:min-h-8 [&::-webkit-details-marker]:hidden">
            <span className="transition-transform group-open:rotate-90">›</span>
            更多篩選：收款狀態
            {paymentFilter && <span className="text-ink-900">（{paymentFilter.label}）</span>}
          </summary>
          <div className="mt-2">
            <FilterChips
              active={sp.payment ?? ''}
              items={PAYMENT_FILTERS.map((filter) => ({
                value: filter.value,
                label: filter.label,
                href: ordersHref({ status: sp.status, payment: filter.value, q: sp.q }),
              }))}
            />
          </div>
        </details>

        {(sp.q?.trim() || paymentFilter || status !== 'todo') && (
          <p className="text-xs text-taupe-500">符合條件 {total} 筆</p>
        )}
      </div>

      {/* 手機：精簡卡片，整張可點 */}
      <ul className="space-y-3 sm:hidden">
        {rows.length === 0 && (
          <li className="border border-cream-200 bg-white px-4 py-12 text-center text-sm text-taupe-500">
            {status === 'todo' ? '目前沒有待處理的訂單' : '沒有符合的訂單'}
          </li>
        )}
        {rows.map(({ order, first, qty, hasPreorder, refundRequested, payment, time, href }) => (
          <li key={order.id} className="relative border border-cream-200 bg-white p-4">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <Link href={href} className="font-mono text-ink-900 after:absolute after:inset-0">
                {order.orderNo}
              </Link>
              <span className="shrink-0 text-taupe-500">{time}</span>
            </div>

            <div className="mt-3 flex gap-3">
              <ItemThumb url={first?.imageUrl ?? null} />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm text-ink-900">{first?.productName ?? '—'}</p>
                <p className="mt-0.5 text-xs text-taupe-500">
                  {qty > 1 ? `共 ${qty} 件` : first?.variantName}
                  {hasPreorder && <Badge tone="muted" className="ml-2">含預購</Badge>}
                </p>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3 text-sm">
              <span className="truncate">{order.recipientName}</span>
              {/* 疊在整張卡片的連結上面，才點得到撥號而不是進明細 */}
              <a href={`tel:${order.phone}`} className="relative z-10 shrink-0 text-xs text-taupe-600 underline underline-offset-4">
                {order.phone}
              </a>
            </div>

            <div className="mt-3 flex items-end justify-between gap-3 border-t border-cream-100 pt-3">
              <div className="min-w-0">
                <div className="text-base tabular-nums text-ink-900">{formatTWD(order.grandTotal)}</div>
                <div className={cn('mt-0.5 text-xs', PAYMENT_TONE_CLASS[payment.tone])}>
                  {payment.text}
                  {payment.method && <span className="text-taupe-500">・{payment.method}</span>}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Badge tone={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS_LABEL[order.status]}</Badge>
                {order.shipment?.status === 'FAILED' && <span className="text-xs text-sale">物流建單失敗</span>}
                {refundRequested && <span className="text-xs text-sale">退款待審核</span>}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {/* 桌機：表格 */}
      <div className="hidden sm:block">
        <DataTable
          headers={['訂單', '商品', '收件人', '金額', '收款', '狀態', '物流']}
          empty={rows.length === 0}
        >
          {rows.map(({ order, first, qty, hasPreorder, refundRequested, payment, time, href }) => (
            <tr key={order.id} className="hover:bg-cream-50">
              <Td>
                <Link href={href} className="font-mono text-xs text-ink-900 underline underline-offset-4">
                  {order.orderNo}
                </Link>
                <div className="mt-0.5 whitespace-nowrap text-xs text-taupe-500">{time}</div>
              </Td>
              <Td>
                <div className="flex items-center gap-3">
                  <ItemThumb url={first?.imageUrl ?? null} size="sm" />
                  <div className="min-w-0 max-w-56">
                    <div className="truncate">{first?.productName ?? '—'}</div>
                    <div className="text-xs text-taupe-500">
                      {qty > 1 ? `共 ${qty} 件` : first?.variantName}
                      {hasPreorder && <Badge tone="muted" className="ml-2">含預購</Badge>}
                    </div>
                  </div>
                </div>
              </Td>
              <Td>
                <div>{order.recipientName}</div>
                <div className="text-xs text-taupe-500">{order.phone}</div>
              </Td>
              <Td className="tabular-nums">{formatTWD(order.grandTotal)}</Td>
              <Td>
                <div className={cn('text-xs', PAYMENT_TONE_CLASS[payment.tone])}>{payment.text}</div>
                {payment.method && <div className="mt-0.5 text-xs text-taupe-500">{payment.method}</div>}
              </Td>
              <Td>
                <Badge tone={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS_LABEL[order.status]}</Badge>
                {refundRequested && <div className="mt-1 text-xs text-sale">退款待審核</div>}
              </Td>
              <Td>
                {order.shipment ? (
                  <>
                    <div
                      className={cn(
                        'text-xs',
                        order.shipment.status === 'FAILED' ? 'text-sale' : 'text-ink-900',
                      )}
                    >
                      {SHIPMENT_STATUS_LABEL[order.shipment.status]}
                    </div>
                    {order.shipment.shipmentNo && (
                      <div className="mt-0.5 font-mono text-xs text-taupe-500">
                        {order.shipment.logisticsSubType === 'TCAT' ? '黑貓 ' : ''}
                        {order.shipment.shipmentNo}
                      </div>
                    )}
                  </>
                ) : (
                  <span className="text-xs text-taupe-500">—</span>
                )}
              </Td>
            </tr>
          ))}
        </DataTable>
      </div>

      <AdminPagination
        page={page}
        totalPages={Math.max(1, Math.ceil(total / PER_PAGE))}
        basePath="/admin/orders"
        searchParams={sp}
      />
    </>
  )
}

/** 訂單明細存的是下單當下的圖片網址；商品圖後來刪掉或換掉的話就留一格米色 */
function ItemThumb({ url, size = 'md' }: { url: string | null; size?: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'h-12 w-9' : 'h-16 w-12'
  return (
    <div className={cn('relative shrink-0 overflow-hidden bg-cream-100', box)}>
      {url && <Image src={url} alt="" fill sizes="48px" className="object-cover" />}
    </div>
  )
}
