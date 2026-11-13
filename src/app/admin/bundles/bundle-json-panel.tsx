'use client'

import * as React from 'react'
import { Braces, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import {
  BUNDLE_JSON_EXAMPLE,
  bundleToJson,
  parseBundleJson,
  type BundleJsonProduct,
  type BundleJsonValues,
} from './bundle-json'

/**
 * 「用 JSON 設定」面板：貼上一整份組合設定，一鍵填好表單（或直接送出）。
 *
 * 只負責把 JSON 轉成表單的值；存檔仍然走同一個 saveBundle、由伺服器做最終驗證。
 */
export function BundleJsonPanel({
  products,
  getCurrent,
  onApply,
  submitLabel,
}: {
  products: BundleJsonProduct[]
  /** 讀目前表單上的值（含還沒存的修改） */
  getCurrent: () => BundleJsonValues
  /** submit = true 時套用後直接送出表單 */
  onApply: (values: BundleJsonValues, options: { submit: boolean }) => void
  submitLabel: string
}) {
  const [open, setOpen] = React.useState(false)
  const [text, setText] = React.useState('')
  const [errors, setErrors] = React.useState<string[]>([])
  const [warnings, setWarnings] = React.useState<string[]>([])

  function apply(submit: boolean) {
    const result = parseBundleJson(text, products)
    if (!result.ok) {
      setErrors(result.errors)
      setWarnings([])
      return
    }
    setErrors([])
    setWarnings(result.warnings)
    onApply(result.values, { submit })
  }

  function exportCurrent() {
    setText(bundleToJson(getCurrent(), products))
    setErrors([])
    setWarnings([])
  }

  return (
    <section className="border border-cream-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="bundle-json-panel"
        className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-cream-50"
      >
        <Braces size={16} className="shrink-0 text-taupe-600" />
        <span className="flex-1">
          <span className="block text-sm tracking-[0.1em]">用 JSON 設定</span>
          <span className="mt-0.5 block text-xs text-taupe-500">
            貼上整份組合設定，一次填好下面的表單；也可以把目前的表單匯出成 JSON 複製到別處
          </span>
        </span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {open && (
        <div id="bundle-json-panel" className="border-t border-cream-200 px-5 pb-5 pt-4">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={16}
            spellCheck={false}
            aria-label="組合設定 JSON"
            aria-invalid={errors.length > 0}
            placeholder={BUNDLE_JSON_EXAMPLE}
            className="font-mono text-xs leading-relaxed"
          />

          {errors.length > 0 && (
            <ul
              role="alert"
              className="mt-3 space-y-1 border border-sale/40 bg-sale/5 px-3 py-2 text-sm text-sale"
            >
              {errors.map((error) => (
                <li key={error}>・{error}</li>
              ))}
            </ul>
          )}
          {warnings.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-taupe-600">
              {warnings.map((warning) => (
                <li key={warning}>・{warning}</li>
              ))}
            </ul>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={() => apply(false)}>
              套用到表單
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => apply(true)}>
              套用並{submitLabel}
            </Button>
            <span className="mx-1 hidden h-5 w-px bg-cream-300 sm:block" aria-hidden />
            <Button type="button" size="sm" variant="ghost" onClick={exportCurrent}>
              從目前表單產生 JSON
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setText(BUNDLE_JSON_EXAMPLE)
                setErrors([])
                setWarnings([])
              }}
            >
              填入範例
            </Button>
          </div>

          <details className="mt-4 text-xs leading-relaxed text-taupe-600">
            <summary className="cursor-pointer select-none text-ink-700">欄位說明</summary>
            <dl className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-[8rem_1fr]">
              <dt className="font-mono text-ink-900">name</dt>
              <dd>組合名稱（必填）</dd>
              <dt className="font-mono text-ink-900">price</dt>
              <dd>組合價，整數元（必填），要低於組合內容的原價合計</dd>
              <dt className="font-mono text-ink-900">items</dt>
              <dd>組合內容，1 到 20 項；每項是 {'{ product, variant, qty }'}</dd>
              <dt className="font-mono text-ink-900">items[].product</dt>
              <dd>商品的 slug、ID 或完整商品名稱</dd>
              <dt className="font-mono text-ink-900">items[].variant</dt>
              <dd>指定規格：SKU、規格名稱或 ID；填 null 或省略代表任一規格（顧客自選）</dd>
              <dt className="font-mono text-ink-900">items[].qty</dt>
              <dd>件數，1 到 20，預設 1</dd>
              <dt className="font-mono text-ink-900">nameEn、description、descriptionEn、slug</dt>
              <dd>選填，同表單</dd>
              <dt className="font-mono text-ink-900">sortOrder、isActive</dt>
              <dd>排序（預設 0）、是否上架（預設 false）</dd>
            </dl>
            <p className="mt-2">
              「從目前表單產生 JSON」匯出的 note 欄位只是方便人看，匯入時會忽略。
            </p>
          </details>
        </div>
      )}
    </section>
  )
}
