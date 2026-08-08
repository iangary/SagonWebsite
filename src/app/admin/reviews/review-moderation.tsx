'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { ReviewStatus } from '@prisma/client'
import { Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { moderateReview } from './actions'

export function ReviewModeration({
  reviewId,
  status,
}: {
  reviewId: string
  status: ReviewStatus
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, setPending] = React.useState(false)

  async function moderate(next: 'APPROVED' | 'REJECTED') {
    let reason: string | undefined
    if (next === 'REJECTED') {
      const input = window.prompt('退回原因（選填，會記錄在稽核紀錄）')
      // 按取消就不動作；留空按確定則視為不填原因直接退回
      if (input === null) return
      reason = input.trim() || undefined
    }

    setPending(true)
    const result = await moderateReview(reviewId, next, reason)
    setPending(false)

    if (!result.ok) {
      toast(result.error ?? '操作失敗', 'error')
      return
    }
    toast(next === 'APPROVED' ? '評論已通過' : '評論已退回')
    router.refresh()
  }

  return (
    <div className="flex gap-1">
      {status !== 'APPROVED' && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => moderate('APPROVED')}>
          <Check size={14} />
          通過
        </Button>
      )}
      {status !== 'REJECTED' && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => moderate('REJECTED')}>
          <X size={14} />
          退回
        </Button>
      )}
    </div>
  )
}
