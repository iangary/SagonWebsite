'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { PhoneCall } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { adminCallTcatPickup } from './actions'

/**
 * 「呼叫黑貓來收貨」。
 *
 * 刻意做成需要兩次確認（件數 → confirm）：按下去司機就真的會出車，
 * 而且黑貓每個收貨點一天只受理一次，按錯了當天沒有第二次機會。
 */
export function PickupButton({
  pendingCount,
  calledToday,
}: {
  /** 已建託運單、還沒被收走的包裹數，當作件數預設值 */
  pendingCount: number
  /** 今天已成功呼叫過的紀錄 */
  calledToday: { quantity: number; message: string | null; createdAt: Date } | null
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, setPending] = React.useState(false)

  async function call() {
    const answer = window.prompt(
      `要請黑貓來收幾件？（目前有 ${pendingCount} 張託運單已建立、尚未被收走）`,
      String(pendingCount || 1),
    )
    if (answer === null) return

    const quantity = Number.parseInt(answer.trim(), 10)
    if (!Number.isInteger(quantity) || quantity < 1) {
      toast('件數要是 1 以上的整數', 'error')
      return
    }

    const memo = window.prompt('備註給司機（可留空，最多 100 字）')?.trim() ?? ''

    const ok = window.confirm(
      `確定要通知黑貓來收 ${quantity} 件嗎？\n\n` +
        '• 司機會依當日路線過來，無法指定時段\n' +
        '• 黑貓每個收貨點一天只受理一次，送出後今天不能再叫\n' +
        '• 請先確認包裹都已打包並貼好託運單',
    )
    if (!ok) return

    setPending(true)
    const result = await adminCallTcatPickup(quantity, memo || undefined)
    setPending(false)

    if (!result.ok) {
      toast(result.error, 'error')
      return
    }
    toast(result.message)
    router.refresh()
  }

  if (calledToday) {
    return (
      <div className="text-right text-xs text-taupe-600">
        <div>
          今天已呼叫黑貓收貨（{calledToday.quantity} 件，
          {calledToday.createdAt.toLocaleTimeString('zh-TW', { hour12: false })}）
        </div>
        {calledToday.message && <div className="mt-1 text-taupe-500">{calledToday.message}</div>}
      </div>
    )
  }

  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={() => void call()}>
      <PhoneCall size={14} />
      呼叫黑貓收貨
    </Button>
  )
}
