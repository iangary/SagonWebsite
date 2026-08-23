'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { RefundStatus } from '@prisma/client'
import { Check, X, Banknote } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { adminApproveRefund, adminCompleteRefund, adminRejectRefund } from './actions'
import type { RefundActionResult } from '@/lib/orders/refund'

/**
 * 一筆退款申請的操作按鈕。
 *
 * 信用卡的「同意」會直接呼叫綠界退刷（可能失敗，所以錯誤要顯示出來）；
 * 其他付款方式的「同意」只是把它排進待匯款，匯完款再按「已完成匯款」。
 */
export function RefundActions({
  refundId,
  status,
  isManual,
}: {
  refundId: string
  status: RefundStatus
  isManual: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, setPending] = React.useState<string | null>(null)

  async function perform(key: string, fn: () => Promise<RefundActionResult>) {
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

  function reject() {
    const note = window.prompt('不受理的原因（會寄給消費者）')
    if (!note?.trim()) return
    void perform('reject', () => adminRejectRefund(refundId, note.trim()))
  }

  function complete() {
    const note = window.prompt('匯款備註（選填，例如匯款日期與末五碼）') ?? ''
    if (!window.confirm('確認已經把款項退給消費者？訂單會標記為已退款。')) return
    void perform('complete', () => adminCompleteRefund(refundId, note))
  }

  const busy = pending !== null
  const done = status === 'COMPLETED' || status === 'REJECTED'
  if (done) return <span className="text-xs text-taupe-500">已結案</span>

  return (
    <div className="flex flex-wrap gap-2">
      {(status === 'REQUESTED' || status === 'FAILED') && (
        <Button size="sm" disabled={busy} onClick={() => perform('approve', () => adminApproveRefund(refundId))}>
          <Check size={14} />
          {isManual ? '同意（轉人工匯款）' : '同意並退刷'}
        </Button>
      )}

      {status === 'APPROVED' && (
        <Button size="sm" variant="outline" disabled={busy} onClick={complete}>
          <Banknote size={14} />
          已完成匯款
        </Button>
      )}

      <Button size="sm" variant="ghost" disabled={busy} onClick={reject}>
        <X size={14} />
        不受理
      </Button>
    </div>
  )
}
