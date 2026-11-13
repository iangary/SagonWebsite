'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { deletePost } from '../actions'

/** 刪除文章：連同譯文與上傳過的圖片一起移除。只是想先下架的話改回草稿就好。 */
export function DeletePost({ postId, title }: { postId: string; title: string }) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, setPending] = React.useState(false)

  async function remove() {
    if (!window.confirm(`確定要永久刪除「${title}」嗎？譯文與文章裡上傳的圖片會一起刪除，無法復原。`)) return
    setPending(true)
    const result = await deletePost(postId)
    setPending(false)
    if (!result.ok) {
      toast(result.error ?? '刪除失敗', 'error')
      return
    }
    toast('文章已刪除')
    router.push('/admin/journal')
  }

  return (
    <section className="border border-sale/30 bg-sale/5 p-5">
      <h2 className="flex items-center gap-2 text-sm tracking-[0.1em] text-sale">
        <AlertTriangle size={15} />
        刪除文章
      </h2>
      <p className="mt-3 text-xs leading-relaxed text-ink-700">
        永久刪除這篇文章、所有譯文，以及上傳到這篇文章的圖片檔，無法復原。
        只是暫時不想讓人看到的話，把狀態改回「草稿」即可。
      </p>
      <Button variant="danger" size="sm" className="mt-4" disabled={pending} onClick={remove}>
        <Trash2 size={14} />
        {pending ? '刪除中…' : '永久刪除'}
      </Button>
    </section>
  )
}
