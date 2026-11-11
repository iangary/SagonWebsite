'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Ban, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { setPurchaseBlock } from './actions'

/**
 * 「停止購買服務／恢復購買」按鈕。會員列表與後台訂單頁（物流退回時）共用。
 *
 * 停權時用 prompt 問原因 —— 之後看到這位會員的人才知道為什麼被停，例如「訂單 XXX 逾期未取」。
 */
export function PurchaseBlockButton({
  userId,
  label,
  blocked,
  defaultReason,
  size = 'sm',
}: {
  userId: string
  label: string
  blocked: boolean
  /** 預填的停權原因（例如後台訂單頁帶入訂單編號） */
  defaultReason?: string
  size?: 'sm' | 'md'
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, setPending] = React.useState(false)

  async function change() {
    let reason: string | undefined
    if (blocked) {
      if (!window.confirm(`要恢復「${label}」的購買服務嗎？對方將可以再次結帳。`)) return
    } else {
      const input = window.prompt(
        `停止「${label}」的購買服務後，對方無法再結帳（仍可登入、查訂單）。\n請輸入原因（只有後台看得到）：`,
        defaultReason ?? '',
      )
      if (input === null) return
      reason = input.trim() || undefined
    }

    setPending(true)
    const result = await setPurchaseBlock({ userId, blocked: !blocked, reason })
    setPending(false)

    if (!result.ok) {
      toast(result.error, 'error')
      return
    }
    toast(result.message)
    router.refresh()
  }

  return (
    <Button
      size={size}
      variant={blocked ? 'outline' : 'ghost'}
      disabled={pending}
      onClick={change}
    >
      {blocked ? <RotateCcw size={13} /> : <Ban size={13} />}
      {pending ? '處理中…' : blocked ? '恢復購買' : '停止購買服務'}
    </Button>
  )
}
