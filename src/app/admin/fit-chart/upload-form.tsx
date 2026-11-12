'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CircleAlert, FileSpreadsheet, Loader2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { DataTable, Td } from '@/components/admin/ui'
import { formatIssue } from '@/lib/fit-chart/sheet'
import { cn } from '@/lib/utils'
import { applyFitChartAction, previewFitChartAction, type PreviewResult } from './actions'

const ACCEPT = '.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv'

const KIND_LABEL = { create: '新增', update: '修改', delete: '刪除' } as const
const KIND_CLASS = {
  create: 'bg-emerald-50 text-emerald-800',
  update: 'bg-amber-50 text-amber-800',
  delete: 'bg-red-50 text-sale',
} as const

/**
 * 選檔 → 預覽（列出新增／修改／刪除幾列、錯誤在第幾列哪一欄）→ 確認寫入。
 * 確認時把同一個檔案連同預覽的指紋再送一次，伺服器重新比對，不吃前端的預覽結果。
 */
export function FitChartUpload() {
  const router = useRouter()
  const { toast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [previewing, startPreview] = useTransition()
  const [applying, startApply] = useTransition()

  function choose(next: File | null) {
    setFile(next)
    setPreview(null)
    if (!next) return
    const fd = new FormData()
    fd.append('file', next)
    startPreview(async () => {
      try {
        setPreview(await previewFitChartAction(fd))
      } catch {
        setPreview({ ok: false, message: '預覽失敗，請稍後再試' })
      }
    })
  }

  function reset() {
    setFile(null)
    setPreview(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  function apply() {
    if (!file || !preview?.ok) return
    const fd = new FormData()
    fd.append('file', file)
    fd.append('fingerprint', preview.fingerprint)
    startApply(async () => {
      const result = await applyFitChartAction(fd).catch(() => ({ ok: false as const, message: '寫入失敗，請稍後再試' }))
      if (!result.ok) {
        toast(result.message, 'error')
        return
      }
      const { create, update, delete: removed } = result.counts
      toast(`已寫入：新增 ${create}、修改 ${update}、刪除 ${removed} 個尺寸`)
      reset()
      router.refresh()
    })
  }

  const ready = preview?.ok && preview.errors.length === 0
  const nothingToDo = ready && preview.counts.create + preview.counts.update + preview.counts.delete === 0

  return (
    <div>
      <label
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-2 border border-dashed border-cream-300 bg-cream-50 px-4 py-8 text-center transition-colors hover:border-taupe-500',
          (previewing || applying) && 'pointer-events-none opacity-60',
        )}
      >
        <FileSpreadsheet size={28} strokeWidth={1.25} className="text-taupe-500" aria-hidden />
        <span className="text-sm text-ink-900">{file ? file.name : '選擇填好的對照表'}</span>
        <span className="text-xs text-taupe-500">.xlsx 或 .csv</span>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={(e) => choose(e.target.files?.[0] ?? null)}
        />
      </label>

      {previewing && (
        <p className="mt-4 flex items-center gap-2 text-sm text-taupe-600">
          <Loader2 size={16} className="animate-spin" aria-hidden />
          正在檢查檔案…
        </p>
      )}

      {preview && !preview.ok && (
        <p role="alert" className="mt-4 flex items-center gap-2 text-sm text-sale">
          <CircleAlert size={16} aria-hidden />
          {preview.message}
        </p>
      )}

      {preview?.ok && (
        <div className="mt-6 space-y-6" aria-live="polite">
          <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-5">
            <Count label="商品" value={preview.counts.products} />
            <Count label="新增" value={preview.counts.create} tone="create" />
            <Count label="修改" value={preview.counts.update} tone="update" />
            <Count label="刪除" value={preview.counts.delete} tone="delete" />
            <Count label="不變" value={preview.counts.unchanged} />
          </div>

          {preview.errors.length > 0 && (
            <IssueList
              title={`有 ${preview.errors.length} 個錯誤，整份都不會寫入。改好後重新上傳。`}
              items={preview.errors.map(formatIssue)}
              tone="error"
            />
          )}
          {preview.warnings.length > 0 && (
            <IssueList title="提醒（不影響寫入）" items={preview.warnings.map(formatIssue)} tone="warning" />
          )}

          {preview.changes.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm text-ink-900">變更明細</h3>
              <DataTable headers={['動作', '商品', '尺寸', '原本', '改成']}>
                {preview.changes.map((c, i) => (
                  <tr key={i}>
                    <Td>
                      <span className={cn('inline-block px-2 py-0.5 text-xs', KIND_CLASS[c.kind])}>
                        {KIND_LABEL[c.kind]}
                      </span>
                    </Td>
                    <Td className="max-w-[20rem] truncate" title={c.productName}>
                      {c.productName}
                    </Td>
                    <Td>{c.size === 'FREE' ? '單一尺寸' : c.size}</Td>
                    <Td className="text-xs text-taupe-600">{c.before ?? '—'}</Td>
                    <Td className="text-xs">{c.after ?? '—'}</Td>
                  </tr>
                ))}
              </DataTable>
              {preview.changesTruncated && (
                <p className="mt-2 text-xs text-taupe-500">只列出前 300 筆，數量以上方統計為準。</p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-cream-200 pt-5">
            <Button onClick={apply} disabled={!ready || nothingToDo || applying}>
              {applying && <Loader2 className="animate-spin" aria-hidden />}
              確認寫入
            </Button>
            <Button variant="ghost" onClick={reset} disabled={applying}>
              取消
            </Button>
            {nothingToDo && <span className="text-sm text-taupe-600">資料與資料庫完全相同，不需要寫入。</span>}
          </div>
        </div>
      )}
    </div>
  )
}

function Count({ label, value, tone }: { label: string; value: number; tone?: keyof typeof KIND_CLASS }) {
  return (
    <div className={cn('border border-cream-200 px-3 py-3', tone && value > 0 ? KIND_CLASS[tone] : 'bg-white')}>
      <p className="text-xs tracking-wide opacity-80">{label}</p>
      <p className="mt-1 text-xl tabular-nums">{value}</p>
    </div>
  )
}

function IssueList({ title, items, tone }: { title: string; items: string[]; tone: 'error' | 'warning' }) {
  const Icon = tone === 'error' ? CircleAlert : TriangleAlert
  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className={cn('border px-4 py-3', tone === 'error' ? 'border-sale/40 bg-red-50' : 'border-amber-200 bg-amber-50')}
    >
      <p className={cn('flex items-center gap-2 text-sm', tone === 'error' ? 'text-sale' : 'text-amber-900')}>
        <Icon size={16} aria-hidden />
        {title}
      </p>
      <ul className="mt-2 max-h-72 list-disc space-y-1 overflow-y-auto pl-6 text-xs leading-relaxed text-ink-700">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  )
}
