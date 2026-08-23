import Link from 'next/link'
import type { Prisma, RefundStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { formatTWD, cn } from '@/lib/utils'
import {
  CHOOSE_PAYMENT_LABEL,
  REFUND_METHOD_LABEL,
  REFUND_STATUS_LABEL,
} from '@/lib/orders/labels'
import {
  PageHeader,
  DataTable,
  Td,
  AdminPagination,
  FilterChips,
} from '@/components/admin/ui'
import { RefundActions } from './refund-actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: '退款' }

const PER_PAGE = 30

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: '', label: '全部' },
  ...Object.entries(REFUND_STATUS_LABEL).map(([value, label]) => ({ value, label })),
]

/**
 * 退款申請佇列。
 *
 * 這裡的資料有兩個來源：消費者在訂單頁申請的，以及系統自己開的
 * （逾期入帳、重複付款 —— 見 lib/orders/payment.ts 的 openSystemRefundRequest）。
 * 後者的原因欄會以「【系統偵測】」開頭。
 */
export default async function AdminRefundsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>
}) {
  const sp = await searchParams
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1)

  const where: Prisma.RefundRequestWhereInput = {}
  if (sp.status && sp.status in REFUND_STATUS_LABEL) {
    where.status = sp.status as RefundStatus
  }

  const [refunds, total, pendingCount] = await Promise.all([
    db.refundRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: {
        order: { select: { id: true, orderNo: true, email: true, recipientName: true } },
        payment: { select: { choosePayment: true, paymentType: true, tradeNo: true } },
      },
    }),
    db.refundRequest.count({ where }),
    db.refundRequest.count({ where: { status: { in: ['REQUESTED', 'APPROVED', 'FAILED'] } } }),
  ])

  return (
    <>
      <PageHeader
        title="退款"
        description={`共 ${total} 筆 ・ ${pendingCount} 筆待處理`}
      />

      <div className="mb-5">
        <FilterChips
          active={sp.status ?? ''}
          items={STATUS_FILTERS.map((filter) => ({
            ...filter,
            href: filter.value ? `/admin/refunds?status=${filter.value}` : '/admin/refunds',
          }))}
        />
      </div>

      <DataTable
        headers={['訂單', '金額', '原付款方式', '退款方式', '狀態', '申請時間', '操作']}
        empty={refunds.length === 0}
      >
        {refunds.map((refund) => (
          <tr key={refund.id} className="align-top hover:bg-cream-50">
            <Td>
              <Link
                href={`/admin/orders/${refund.order.id}`}
                className="tabular-nums text-ink-900 underline underline-offset-4"
              >
                {refund.order.orderNo}
              </Link>
              <div className="mt-0.5 text-xs text-taupe-500">{refund.order.recipientName}</div>
              <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-taupe-600">
                {refund.reason}
              </p>
              {refund.bankAccountNo && (
                <p className="mt-1.5 text-xs text-ink-700">
                  匯款帳戶：{refund.bankCode} / {refund.bankAccountNo}（{refund.accountName}）
                </p>
              )}
              {refund.failReason && (
                <p className="mt-1.5 text-xs text-sale">{refund.failReason}</p>
              )}
            </Td>
            <Td className="tabular-nums">{formatTWD(refund.amount)}</Td>
            <Td className="text-taupe-600">
              {CHOOSE_PAYMENT_LABEL[refund.payment?.choosePayment ?? ''] ?? '—'}
            </Td>
            <Td className="text-taupe-600">
              {refund.method ? REFUND_METHOD_LABEL[refund.method] : '未定'}
            </Td>
            <Td>
              <span
                className={cn(
                  'text-xs',
                  refund.status === 'FAILED' || refund.status === 'REQUESTED'
                    ? 'text-sale'
                    : 'text-ink-700',
                )}
              >
                {REFUND_STATUS_LABEL[refund.status]}
              </span>
            </Td>
            <Td className="whitespace-nowrap text-xs text-taupe-500">
              {refund.createdAt.toLocaleString('zh-TW', { hour12: false })}
            </Td>
            <Td>
              <RefundActions
                refundId={refund.id}
                status={refund.status}
                // 只有信用卡且有綠界交易編號才退得了刷，其他一律人工匯款
                isManual={
                  refund.method === 'MANUAL_TRANSFER' ||
                  !refund.payment?.tradeNo ||
                  !(refund.payment.paymentType ?? refund.payment.choosePayment).startsWith('Credit')
                }
              />
            </Td>
          </tr>
        ))}
      </DataTable>

      <AdminPagination
        page={page}
        totalPages={Math.max(1, Math.ceil(total / PER_PAGE))}
        basePath="/admin/refunds"
        searchParams={sp}
      />
    </>
  )
}
