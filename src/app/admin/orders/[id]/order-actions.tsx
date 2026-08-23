'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type {
  InvoiceStatus,
  OrderStatus,
  PaymentStatus,
  ReceiptStatus,
  ShippingMethod,
} from '@prisma/client'
import { Truck, Printer, Receipt, Ban, XCircle, FileText, RefreshCw, Banknote } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import {
  adminCreateShipment,
  adminIssueReceipt,
  adminVoidReceipt,
  adminRecordInvoice,
  adminRecordTcatShipment,
  adminUpdateOrderStatus,
  adminCancelOrder,
  adminSyncPayment,
  adminMarkCodCollected,
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
  shippingMethod,
  hasShipment,
  hasLabel,
  invoiceStatus,
  receiptStatus,
  printForm,
  manualNote,
  paymentProvider,
  paymentStatus,
}: {
  orderId: string
  orderStatus: OrderStatus
  shippingMethod: ShippingMethod
  hasShipment: boolean
  /** 黑貓託運單 PDF 是否已下載存檔 */
  hasLabel: boolean
  invoiceStatus: InvoiceStatus | null
  receiptStatus: ReceiptStatus | null
  printForm: { action: string; params: Record<string, string> } | null
  /** 建單曾轉人工處理的說明；存在時重按建單需要先確認（避免重複開單） */
  manualNote: string | null
  /** ECPAY / COD。決定「確認付款」要走綠界查詢還是手動標記收款。 */
  paymentProvider: string | null
  paymentStatus: PaymentStatus | null
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

  function voidReceipt() {
    const reason = window.prompt('請輸入作廢原因（最多 200 字）')
    if (!reason?.trim()) return
    void perform('void-receipt', () => adminVoidReceipt(orderId, reason.trim()))
  }

  function recordInvoice() {
    const number = window.prompt('請輸入已開立的紙本發票號碼（例如 AB12345678）')
    if (!number?.trim()) return
    void perform('record-invoice', () => adminRecordInvoice(orderId, number.trim().toUpperCase()))
  }

  function recordTcat() {
    const no = window.prompt('請輸入黑貓托運單號')
    if (!no?.trim()) return
    void perform('record-tcat', () => adminRecordTcatShipment(orderId, no.trim()))
  }

  function cancelOrder() {
    if (!window.confirm('確定要取消這張訂單嗎？庫存會一併釋放，此動作無法復原。')) return
    void perform('cancel', () => adminCancelOrder(orderId))
  }

  const isPaid = !['PENDING_PAYMENT', 'CANCELLED'].includes(orderStatus)
  const isCvs = shippingMethod === 'CVS'
  const isCod = paymentProvider === 'COD'
  const codPending = isCod && paymentStatus === 'AWAITING_COLLECTION'

  function markCollected() {
    if (!window.confirm('確認已經收到這筆貨到付款的貨款？')) return
    void perform('cod-collected', () => adminMarkCodCollected(orderId))
  }

  function createShipment() {
    if (manualNote) {
      const ok = window.confirm(
        `這張訂單先前建單時轉為人工處理：\n\n${manualNote}\n\n` +
          '若物流端可能已經成單，重新建單會產生第二張真實託運單。確定要重新建單嗎？',
      )
      if (!ok) return
    }
    void perform('shipment', () => adminCreateShipment(orderId))
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border border-cream-200 bg-white p-4">
      {/* 「客戶到底付款了沒」。
          綠界金流：直接問綠界（QueryTradeInfo），可補回漏掉的 ReturnURL 通知。
          貨到付款：物流回報已取貨時會自動標記，這顆是例外情況的手動確認。 */}
      {isCod ? (
        <Button size="sm" variant="outline" disabled={!codPending || pending !== null} onClick={markCollected}>
          <Banknote size={14} />
          {codPending ? '標記已收款' : '貨款已收'}
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={pending !== null || paymentProvider === null}
          onClick={() => perform('sync-payment', () => adminSyncPayment(orderId))}
        >
          <RefreshCw size={14} />
          向綠界查詢付款
        </Button>
      )}

      {/* 超商走綠界、宅配走黑貓，兩邊都由 adminCreateShipment 分流建單 */}
      <Button
        size="sm"
        variant="outline"
        disabled={!isPaid || hasShipment || pending !== null}
        onClick={createShipment}
      >
        <Truck size={14} />
        {hasShipment ? '已建立物流單' : isCvs ? '建立物流訂單' : '建立黑貓託運單'}
      </Button>

      {/* 列印一段標必須 POST 到綠界並帶簽章，所以用一張隱藏表單開新視窗 */}
      {printForm && (
        <form action={printForm.action} method="post" target="_blank">
          {Object.entries(printForm.params).map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
          <Button size="sm" variant="outline" type="submit">
            <Printer size={14} />
            列印一段標
          </Button>
        </form>
      )}

      {/* 黑貓託運單是建單當下就抓回來的 PDF，直接開檔即可 */}
      {hasLabel && (
        <Button size="sm" variant="outline" asChild>
          <a href={`/api/admin/labels/${orderId}`} target="_blank" rel="noreferrer">
            <Printer size={14} />
            列印託運單
          </a>
        </Button>
      )}

      {/* 建單逾時等例外情況的補救：到黑貓後台抄單號回填，不要重按建單 */}
      {!isCvs && (
        <Button
          size="sm"
          variant="ghost"
          disabled={!isPaid || pending !== null}
          onClick={recordTcat}
        >
          回填托運單號
        </Button>
      )}

      <Button
        size="sm"
        variant="outline"
        disabled={!isPaid || invoiceStatus === 'ISSUED' || pending !== null}
        onClick={recordInvoice}
      >
        <FileText size={14} />
        {invoiceStatus === 'ISSUED' ? '發票已登錄' : '回填發票號碼'}
      </Button>

      <Button
        size="sm"
        variant="outline"
        disabled={!isPaid || receiptStatus === 'ISSUED' || pending !== null}
        onClick={() => perform('receipt', () => adminIssueReceipt(orderId))}
      >
        <Receipt size={14} />
        {receiptStatus === 'ISSUED' ? '收據已開立' : '開立電子收據'}
      </Button>

      {receiptStatus === 'ISSUED' && (
        <Button size="sm" variant="ghost" disabled={pending !== null} onClick={voidReceipt}>
          <Ban size={14} />
          作廢收據
        </Button>
      )}

      {/* 手機上獨佔一行 —— 跟其他按鈕擠在同一行時下拉選單會被壓到剩幾十 px */}
      <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
        <select
          value=""
          disabled={pending !== null}
          onChange={(e) => {
            const value = e.target.value as OrderStatus
            if (!value) return
            void perform('status', () => adminUpdateOrderStatus(orderId, value))
            e.target.value = ''
          }}
          className="min-h-11 flex-1 border border-cream-300 bg-white px-3 text-sm focus:border-taupe-500 focus:outline-none sm:min-h-9 sm:flex-none"
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
