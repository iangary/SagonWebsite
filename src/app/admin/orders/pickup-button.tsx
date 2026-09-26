import Link from 'next/link'
import { PhoneCall } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * 訂單列表上的「呼叫黑貓收貨」入口。
 *
 * 真正的叫車在 /admin/orders/pickup —— 要先勾選這一趟交寄哪幾張訂單，
 * 按鈕本身只負責把「今天叫過沒、還有幾件待交寄」擺在眼前。
 */
export function PickupButton({
  pendingCount,
  calledToday,
}: {
  /** 已建託運單、還沒被收走也還沒排入收貨的包裹數 */
  pendingCount: number
  /** 今天已成功呼叫過的紀錄 */
  calledToday: { quantity: number; message: string | null; createdAt: Date } | null
}) {
  if (calledToday) {
    return (
      <div className="text-xs text-taupe-600 sm:text-right">
        <div>
          今天已呼叫黑貓收貨（{calledToday.quantity} 件，
          {calledToday.createdAt.toLocaleTimeString('zh-TW', { hour12: false })}）
          <Link href="/admin/orders/pickup" className="ml-2 text-ink-900 underline underline-offset-4">
            查看
          </Link>
        </div>
        {calledToday.message && <div className="mt-1 text-taupe-500">{calledToday.message}</div>}
      </div>
    )
  }

  return (
    <Button size="sm" variant="outline" asChild>
      <Link href="/admin/orders/pickup">
        <PhoneCall size={14} />
        呼叫黑貓收貨{pendingCount > 0 ? `（${pendingCount} 件待交寄）` : ''}
      </Link>
    </Button>
  )
}
