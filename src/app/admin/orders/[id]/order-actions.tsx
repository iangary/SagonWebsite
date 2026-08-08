'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { InvoiceStatus, OrderStatus } from '@prisma/client'
import { Truck, Printer, Receipt, Ban, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import {
  adminCreateShipment,
  adminIssueInvoice,
  adminVoidInvoice,
  adminUpdateOrderStatus,
  adminCancelOrder,
  type AdminActionResult,
} from '../actions'

const MANUAL_STATUSES: { value: OrderStatus; label: string }[] = [
  { value: 'PROCESSING', label: '備貨中' },
  { value: 'SHIPPED', label: '已出貨' },
  { value: 'COMPLETED', label: '已完成' },
  { value: 'REFUNDED', label: '已退款' },
]

export function OrderActions({
  orderId,
  orderStatus,
  hasShipment,
  invoiceStatus,
  printForm,
}: {
  orderId: string
  orderStatus: OrderStatus
  hasShipment: boolean
  invoiceStatus: InvoiceStatus | null
  printForm: { action: string; params: Record<string, string> } | null
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, setPending] = React.useState<string | null>(null)

  async function perform(key: string, fn: () => Promise<AdminActionResult>) {
    setPending(key)
    const result = await fn()
    setPending(null)

    if (!result.ok) {
      toast(result.error, 'error')
      return
    }
    toast(result.message)
    router.refresh()
  }

  function voidInvoice() {
    const reason = window.prompt('請輸入作廢原因（最多 20 字）')
    if (!reason?.trim()) return
    void perform('void-invoice', () => adminVoidInvoice(orderId, reason.trim()))
  }

  function cancelOrder() {
    if (!window.confirm('確定要取消這張訂單嗎？庫存會一併釋放，此動作無法復原。')) return
    void perform('cancel', () => adminCancelOrder(orderId))
  }

  const isPaid = !['PENDING_PAYMENT', 'CANCELLED'].includes(orderStatus)

  return (
    <div className="flex flex-wrap items-center gap-2 border border-cream-200 bg-white p-4">
      <Button
        size="sm"
        variant="outline"
        disabled={!isPaid || hasShipment || pending !== null}
        onClick={() => perform('shipment', () => adminCreateShipment(orderId))}
      >
        <Truck size={14} />
        {hasShipment ? '已建立物流單' : '建立物流訂單'}
      </Button>

      {/* 列印單據必須 POST 到綠界並帶簽章，所以用一張隱藏表單開新視窗 */}
      {printForm && (
        <form action={printForm.action} method="post" target="_blank">
          {Object.entries(printForm.params).map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
          <Button size="sm" variant="outline" type="submit">
            <Printer size={14} />
            列印單據
          </Button>
        </form>
      )}

      <Button
        size="sm"
        variant="outline"
        disabled={!isPaid || invoiceStatus === 'ISSUED' || pending !== null}
        onClick={() => perform('invoice', () => adminIssueInvoice(orderId))}
      >
        <Receipt size={14} />
        {invoiceStatus === 'ISSUED' ? '發票已開立' : '開立發票'}
      </Button>

      {invoiceStatus === 'ISSUED' && (
        <Button size="sm" variant="ghost" disabled={pending !== null} onClick={voidInvoice}>
          <Ban size={14} />
          作廢發票
        </Button>
      )}

      <div className="ml-auto flex items-center gap-2">
        <select
          value=""
          disabled={pending !== null}
          onChange={(e) => {
            const value = e.target.value as OrderStatus
            if (!value) return
            void perform('status', () => adminUpdateOrderStatus(orderId, value))
            e.target.value = ''
          }}
          className="border border-cream-300 bg-white px-3 py-1.5 text-sm focus:border-taupe-500 focus:outline-none"
        >
          <option value="">手動變更狀態…</option>
          {MANUAL_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        {orderStatus === 'PENDING_PAYMENT' && (
          <Button size="sm" variant="danger" disabled={pending !== null} onClick={cancelOrder}>
            <XCircle size={14} />
            取消訂單
          </Button>
        )}
      </div>
    </div>
  )
}
