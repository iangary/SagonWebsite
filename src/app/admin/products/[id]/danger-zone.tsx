'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { deleteProduct } from '../actions'

/**
 * 賣過的商品不能真的刪除（歷史訂單與評論會失去關聯），會自動改成封存。
 * 這裡把行為先講清楚，避免營運以為按下去資料就消失了。
 */
export function DangerZone({
  productId,
  productName,
  soldCount,
}: {
  productId: string
  productName: string
  soldCount: number
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, setPending] = React.useState(false)

  const willArchive = soldCount > 0

  async function remove() {
    const message = willArchive
      ? `「${productName}」已有 ${soldCount} 筆銷售紀錄，將改為「封存」（前台隱藏、資料保留）。確定嗎？`
      : `確定要永久刪除「${productName}」嗎？圖片會一併從磁碟移除，此動作無法復原。`

    if (!window.confirm(message)) return

    setPending(true)
    const result = await deleteProduct(productId)
    setPending(false)

    if (!result.ok) {
      toast(result.error ?? '操作失敗', 'error')
      return
    }

    toast(result.message ?? '已完成')
    if (willArchive) {
      router.refresh()
    } else {
      router.push('/admin/products')
    }
  }

  return (
    <section className="border border-sale/30 bg-sale/5 p-5">
      <h2 className="flex items-center gap-2 text-sm tracking-[0.1em] text-sale">
        <AlertTriangle size={15} />
        危險操作
      </h2>

      <p className="mt-3 text-xs leading-relaxed text-ink-700">
        {willArchive ? (
          <>
            這個商品已有 <strong>{soldCount}</strong> 筆銷售紀錄，因此
            <strong>不會被真的刪除</strong>，只會改為封存 —— 前台隱藏，但歷史訂單、
            發票與評論的關聯都保留。
          </>
        ) : (
          <>
            這個商品從未被購買，可以永久刪除。所有規格與圖片（含磁碟上的檔案）
            都會一併移除，無法復原。若只是暫時不賣，請改用上方的「已封存」狀態。
          </>
        )}
      </p>

      <Button variant="danger" size="sm" className="mt-4" disabled={pending} onClick={remove}>
        <Trash2 size={14} />
        {pending ? '處理中…' : willArchive ? '封存商品' : '永久刪除商品'}
      </Button>
    </section>
  )
}
