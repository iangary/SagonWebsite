'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Download, FileUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { IMPORT_TEMPLATE } from './import-template'

type ImportResponse =
  | {
      ok: true
      postId: string
      created: boolean
      title: string
      status: 'DRAFT' | 'PUBLISHED'
      imagesSaved: number
      translations: string[]
      warnings: string[]
    }
  | { ok: false; error: string }

/**
 * 「匯入 HTML 檔」按鈕：一個檔案就是一整篇文章（標題、摘要、標籤、封面、內文、譯文、圖片）。
 * 給了 postId 是覆蓋那篇，沒給是新建一篇。
 *
 * 走 /api/admin/journal/import 而不是 server action：內嵌 base64 圖片的檔案常常超過
 * server action 的 8MB 上限。
 */
export function ImportHtml({ postId, postTitle }: { postId?: string; postTitle?: string }) {
  const router = useRouter()
  const { toast } = useToast()
  const fileRef = React.useRef<HTMLInputElement>(null)
  const [pending, setPending] = React.useState(false)

  async function upload(file: File) {
    if (fileRef.current) fileRef.current.value = ''
    if (
      postId &&
      !window.confirm(
        `用「${file.name}」覆蓋「${postTitle ?? '這篇文章'}」嗎？\n\n` +
          '標題與內文會整個換掉；摘要、標籤、封面、狀態等欄位檔案裡有寫才會換。還沒按「儲存」的修改會遺失。',
      )
    ) {
      return
    }

    const form = new FormData()
    form.set('file', file)
    if (postId) form.set('postId', postId)

    setPending(true)
    let result: ImportResponse
    try {
      const res = await fetch('/api/admin/journal/import', { method: 'POST', body: form })
      result = (await res.json()) as ImportResponse
    } catch {
      result = { ok: false, error: '匯入失敗，請檢查網路後再試' }
    }
    setPending(false)

    if (!result.ok) {
      toast(result.error, 'error')
      return
    }

    const parts = [
      result.created ? `已建立「${result.title}」` : `已用檔案覆蓋「${result.title}」`,
      result.status === 'PUBLISHED' ? '狀態：發布' : '狀態：草稿',
      result.imagesSaved > 0 ? `存了 ${result.imagesSaved} 張圖片` : null,
      result.translations.length > 0 ? `譯文：${result.translations.join('、')}` : null,
    ].filter(Boolean)
    toast(parts.join('，'))

    // 提醒交給編輯頁顯示：換頁／重載後 toast 與元件狀態都會消失
    try {
      sessionStorage.setItem(WARNINGS_KEY, JSON.stringify(result.warnings))
    } catch {}
    if (result.created) {
      router.push(`/admin/journal/${result.postId}`)
    } else {
      // 編輯表單用的是 defaultValue 與元件內部狀態，整頁重載才會換成剛匯入的內容
      window.location.reload()
    }
  }

  function downloadTemplate() {
    const blob = new Blob([IMPORT_TEMPLATE], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '專欄文章範本.html'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant={postId ? 'outline' : 'primary'} disabled={pending} onClick={() => fileRef.current?.click()}>
          <FileUp size={14} />
          {pending ? '匯入中…（圖片多的話要等一下）' : postId ? '用 HTML 檔覆蓋整篇' : '選擇 HTML 檔'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={downloadTemplate}>
          <Download size={14} />
          下載範本
        </Button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".html,.htm,text/html"
        hidden
        onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
      />
    </div>
  )
}

const WARNINGS_KEY = 'journal-import-warnings'

/** 編輯頁上方：剛匯入完的提醒（讀一次就清掉，重新整理不會再出現）。 */
export function ImportWarnings() {
  const [warnings, setWarnings] = React.useState<string[]>([])
  React.useEffect(() => {
    try {
      const raw = sessionStorage.getItem(WARNINGS_KEY)
      if (!raw) return
      sessionStorage.removeItem(WARNINGS_KEY)
      const list = JSON.parse(raw) as unknown
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage 只能在掛載後讀
      if (Array.isArray(list)) setWarnings(list.filter((w): w is string => typeof w === 'string'))
    } catch {}
  }, [])
  if (warnings.length === 0) return null
  return (
    <div className="mt-3 border border-rose-accent/40 bg-rose-accent/5 p-3 text-xs leading-relaxed text-ink-700">
      <p className="mb-1 font-medium text-ink-900">匯入完成，但有幾件事要留意：</p>
      <ul className="list-disc space-y-0.5 pl-5">
        {warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </div>
  )
}
