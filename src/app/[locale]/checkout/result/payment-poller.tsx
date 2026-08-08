'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

const POLL_INTERVAL_MS = 2500
const MAX_POLLS = 12 // 約 30 秒

/**
 * 綠界的背景通知（ReturnURL）與把使用者導回結果頁是兩條獨立的請求，
 * 導回可能比通知先到，這時訂單還是 PENDING_PAYMENT。
 *
 * 這裡短暫輪詢訂單狀態，一旦後端收到通知就自動重新整理頁面，
 * 避免使用者付完款卻看到「等待付款」而困惑。
 */
export function PaymentPoller({ orderNo }: { orderNo: string }) {
  const router = useRouter()
  const [polling, setPolling] = React.useState(true)

  React.useEffect(() => {
    let attempts = 0
    let cancelled = false

    const timer = setInterval(async () => {
      attempts++
      if (attempts > MAX_POLLS) {
        clearInterval(timer)
        if (!cancelled) setPolling(false)
        return
      }

      try {
        const res = await fetch(`/api/orders/${orderNo}/status`, { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as { status: string }

        if (data.status !== 'PENDING_PAYMENT') {
          clearInterval(timer)
          if (!cancelled) router.refresh()
        }
      } catch {
        // 網路瞬斷就等下一輪
      }
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [orderNo, router])

  if (!polling) return null

  return (
    <p className="mb-8 flex items-center justify-center gap-2 border border-cream-300 bg-white px-4 py-2.5 text-xs text-taupe-600">
      <Loader2 size={13} className="animate-spin" />
      正在向綠界確認付款結果…
    </p>
  )
}
