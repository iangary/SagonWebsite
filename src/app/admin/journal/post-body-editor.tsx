'use client'

import * as React from 'react'
import {
  Bold,
  FileCode,
  Heading2,
  Heading3,
  ImagePlus,
  List,
  Minus,
  Monitor,
  Pilcrow,
  Quote,
  ShoppingBag,
  Smartphone,
  X,
} from 'lucide-react'
import { Textarea } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { escapeHtml, extractProductSlugs, sanitizePostHtml } from '@/lib/journal/html'
import { cn } from '@/lib/utils'
import {
  previewEmbeddedProducts,
  searchProductsForEmbed,
  uploadPostImages,
  type EmbeddableProduct,
} from './actions'

/**
 * 文章內文的 HTML 編輯器 + 即時預覽。
 *
 * 內文就是 HTML：可以直接打、貼上，或用「匯入 HTML 檔」把別處排好的文件整份載進來。
 * 預覽跑的是和前台同一支 sanitizePostHtml 與同一組 CSS，被允許清單拔掉的東西
 * （script、iframe、<style>、不在清單的 inline style）在預覽裡一樣看不到 —— 看到什麼，前台就是什麼。
 *
 * 工具列插入走 execCommand('insertText')，保留 Ctrl+Z 的復原紀錄（直接改 value 會清掉）。
 */

type Device = 'desktop' | 'mobile'
const PREVIEW_WIDTH: Record<Device, string> = { desktop: '45rem', mobile: '327px' }

export function PostBodyEditor({
  id,
  name,
  defaultValue = '',
  postId,
  error,
}: {
  id: string
  name: string
  defaultValue?: string
  postId: string
  error?: string
}) {
  const { toast } = useToast()
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const imageRef = React.useRef<HTMLInputElement>(null)
  const htmlFileRef = React.useRef<HTMLInputElement>(null)
  const [value, setValue] = React.useState(defaultValue)
  const [device, setDevice] = React.useState<Device>('desktop')
  const [uploading, setUploading] = React.useState(false)
  const [pickerOpen, setPickerOpen] = React.useState(false)

  const deferred = React.useDeferredValue(value)

  // 嵌入的商品卡片由伺服器組好（同前台），slug 清單變了才重抓
  const slugKey = extractProductSlugs(deferred).join('\n')
  const [cards, setCards] = React.useState<Record<string, string>>({})
  React.useEffect(() => {
    const slugs = slugKey ? slugKey.split('\n') : []
    if (slugs.length === 0) return
    let cancelled = false
    previewEmbeddedProducts(slugs)
      .then((result) => !cancelled && setCards(result))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [slugKey])

  const previewHtml = React.useMemo(
    () =>
      sanitizePostHtml(
        deferred,
        (slug) =>
          cards[slug] ??
          `<span class="journal-product is-missing">找不到上架中的商品「${escapeHtml(slug)}」，前台不會顯示這張卡片</span>`,
      ),
    [deferred, cards],
  )

  function replaceSelection(text: string, at?: (value: string, pos: number) => number) {
    const el = textareaRef.current
    if (!el) return
    el.focus()
    if (at && el.selectionStart === el.selectionEnd) {
      const pos = at(el.value, el.selectionStart)
      el.setSelectionRange(pos, pos)
    }
    if (!document.execCommand('insertText', false, text)) {
      el.setRangeText(text, el.selectionStart, el.selectionEnd, 'end')
      setValue(el.value)
    }
  }

  function selectedText(): string {
    const el = textareaRef.current
    return el ? el.value.slice(el.selectionStart, el.selectionEnd) : ''
  }

  function wrap(tag: string, placeholder: string, inline = false) {
    const text = selectedText() || placeholder
    replaceSelection(`<${tag}>${text}</${tag}>`, inline ? outsideTag : afterBlock)
  }

  function insertList() {
    const lines = (selectedText() || '項目一\n項目二')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    replaceSelection(`<ul>\n${lines.map((l) => `  <li>${l}</li>`).join('\n')}\n</ul>`, afterBlock)
  }

  async function uploadImages(files: FileList) {
    if (files.length === 0) return
    const form = new FormData()
    form.set('postId', postId)
    for (const file of Array.from(files)) form.append('images', file)

    setUploading(true)
    const result = await uploadPostImages(form)
    setUploading(false)
    if (imageRef.current) imageRef.current.value = ''

    for (const failure of result.failures ?? []) toast(`${failure.filename}：${failure.reason}`, 'error')
    if (!result.ok || !result.images) {
      toast(result.error ?? '上傳失敗', 'error')
      return
    }

    replaceSelection(
      '\n' +
        result.images
          .map((img) => `<p><img src="${img.url}" width="${img.width}" height="${img.height}" alt=""></p>`)
          .join('\n') +
        '\n',
      afterBlock,
    )
    toast(`已插入 ${result.images.length} 張圖片，記得按「儲存」`)
  }

  async function importHtmlFile(file: File) {
    if (htmlFileRef.current) htmlFileRef.current.value = ''
    if (file.size > 1024 * 1024) {
      toast('HTML 檔超過 1 MB，請確認圖片不是直接內嵌在檔案裡', 'error')
      return
    }
    const text = await file.text()
    // DOMParser 只解析不執行（script 不會跑、圖片不會載入），用來取 <body> 與檢查圖片路徑
    const doc = new DOMParser().parseFromString(text, 'text/html')
    const body = doc.body.innerHTML.trim()
    if (!body) {
      toast('這個檔案裡沒有內容', 'error')
      return
    }

    const el = textareaRef.current
    if (el && el.value.trim() && !window.confirm('要用這個檔案取代目前的內文嗎？（之後仍可按 Ctrl+Z 還原）')) {
      return
    }

    if (el) {
      el.focus()
      el.select()
    }
    replaceSelection(body)

    const srcs = Array.from(doc.querySelectorAll('img')).map((img) => img.getAttribute('src') ?? '')
    const local = srcs.filter((s) => s && !/^(https?:)?\/\//i.test(s) && !s.startsWith('/') && !s.startsWith('data:'))
    const inline = srcs.filter((s) => s.startsWith('data:'))
    const scripts = doc.querySelectorAll('script, iframe, style, form').length

    toast(`已匯入「${file.name}」，記得按「儲存」`)
    if (local.length + inline.length > 0) {
      toast(
        `有 ${local.length + inline.length} 張圖片是電腦上的檔案或內嵌圖，前台看不到 —— 請用「圖片」按鈕上傳後替換`,
        'error',
      )
    }
    if (scripts > 0) {
      toast('檔案裡的 script、iframe、樣式表與表單在前台會被移除（預覽已經是移除後的樣子）')
    }
  }

  function insertProduct(product: EmbeddableProduct) {
    replaceSelection(`\n<p>{{product:${product.slug}}}</p>\n`, afterBlock)
    setPickerOpen(false)
    if (product.status !== 'ACTIVE') toast('這件商品目前沒有上架，前台暫時不會顯示卡片', 'error')
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(20rem,1fr)_minmax(0,47.125rem)]">
      <div className="flex min-w-0 flex-col">
        <div className="flex flex-wrap items-center gap-1 border border-b-0 border-cream-300 bg-cream-50 px-1.5 py-1">
          <ToolButton label="段落" onClick={() => wrap('p', '段落文字')}>
            <Pilcrow size={15} />
          </ToolButton>
          <ToolButton label="粗體" onClick={() => wrap('strong', '粗體文字', true)}>
            <Bold size={15} />
          </ToolButton>
          <ToolButton label="大標題" onClick={() => wrap('h2', '大標題')}>
            <Heading2 size={15} />
          </ToolButton>
          <ToolButton label="小標題" onClick={() => wrap('h3', '小標題')}>
            <Heading3 size={15} />
          </ToolButton>
          <ToolButton label="清單（每行一項）" onClick={insertList}>
            <List size={15} />
          </ToolButton>
          <ToolButton label="引言" onClick={() => wrap('blockquote', '引言文字')}>
            <Quote size={15} />
          </ToolButton>
          <ToolButton label="分隔線" onClick={() => replaceSelection('\n<hr>\n', afterBlock)}>
            <Minus size={15} />
          </ToolButton>

          <span className="mx-1 h-4 w-px bg-cream-300" aria-hidden />

          <ToolButton label="上傳並插入圖片" disabled={uploading} onClick={() => imageRef.current?.click()}>
            <ImagePlus size={15} />
            <span className="text-xs">{uploading ? '上傳中…' : '圖片'}</span>
          </ToolButton>
          <ToolButton label="插入商品卡片" pressed={pickerOpen} onClick={() => setPickerOpen((v) => !v)}>
            <ShoppingBag size={15} />
            <span className="text-xs">商品</span>
          </ToolButton>
          <ToolButton label="匯入 HTML 檔（取代目前內文）" onClick={() => htmlFileRef.current?.click()}>
            <FileCode size={15} />
            <span className="text-xs">匯入 HTML 檔</span>
          </ToolButton>

          <input
            ref={imageRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
            multiple
            hidden
            onChange={(e) => e.target.files && uploadImages(e.target.files)}
          />
          <input
            ref={htmlFileRef}
            type="file"
            accept=".html,.htm,text/html"
            hidden
            onChange={(e) => e.target.files?.[0] && importHtmlFile(e.target.files[0])}
          />
        </div>

        {pickerOpen && <ProductPicker onPick={insertProduct} onClose={() => setPickerOpen(false)} />}

        <Textarea
          ref={textareaRef}
          id={id}
          name={name}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={error ? true : undefined}
          className="h-[36rem] resize-y font-mono text-xs leading-relaxed xl:h-[44rem]"
          placeholder={'<p>第一段文字…</p>\n<h2>小標題</h2>\n<p>{{product:商品網址代稱}}</p>'}
          spellCheck={false}
        />
        <p className="mt-1.5 text-xs leading-relaxed text-taupe-500">
          可以直接貼上 HTML。<code className="text-ink-700">{'{{product:商品網址代稱}}'}</code>{' '}
          單獨一段會顯示成商品卡片（用「商品」按鈕搜尋插入最方便）；商品下架時卡片自動消失。
        </p>
      </div>

      <div className="flex min-w-0 flex-col">
        <div className="flex items-center justify-between border border-b-0 border-cream-300 bg-cream-50 px-3 py-1">
          <span className="text-xs text-taupe-600">前台預覽</span>
          <div className="flex gap-1" role="group" aria-label="預覽寬度">
            <ToolButton label="桌機寬度" pressed={device === 'desktop'} onClick={() => setDevice('desktop')}>
              <Monitor size={15} />
            </ToolButton>
            <ToolButton label="手機寬度" pressed={device === 'mobile'} onClick={() => setDevice('mobile')}>
              <Smartphone size={15} />
            </ToolButton>
          </div>
        </div>

        <div className="h-[36rem] overflow-auto border border-cream-300 bg-cream-50 px-4 py-8 xl:h-[44rem]">
          {previewHtml ? (
            <div
              className="prose-product prose-journal mx-auto"
              style={{
                maxWidth: PREVIEW_WIDTH[device],
                ...(device === 'mobile' ? { fontSize: '0.9375rem' } : {}),
              }}
              // 已經過 sanitizePostHtml 的允許清單；商品卡片是伺服器用跳脫過的值組出來的
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          ) : (
            <p className="text-center text-sm text-taupe-500">內文是空的。</p>
          )}
        </div>
      </div>
    </div>
  )
}

function ProductPicker({
  onPick,
  onClose,
}: {
  onPick: (product: EmbeddableProduct) => void
  onClose: () => void
}) {
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<EmbeddableProduct[] | null>(null)
  const deferredQuery = React.useDeferredValue(query)

  React.useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      searchProductsForEmbed(deferredQuery)
        .then((rows) => !cancelled && setResults(rows))
        .catch(() => !cancelled && setResults([]))
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [deferredQuery])

  return (
    <div className="border border-b-0 border-cream-300 bg-white p-3">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onClose()}
          placeholder="搜尋商品名稱…"
          className="min-h-9 w-full border border-cream-300 px-3 text-sm focus:border-taupe-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="關閉商品搜尋"
          className="flex size-9 shrink-0 items-center justify-center text-taupe-500 hover:text-ink-900"
        >
          <X size={16} />
        </button>
      </div>
      <ul className="mt-2 max-h-64 overflow-y-auto">
        {results === null && <li className="px-2 py-3 text-xs text-taupe-500">搜尋中…</li>}
        {results?.length === 0 && <li className="px-2 py-3 text-xs text-taupe-500">找不到商品</li>}
        {results?.map((p) => (
          <li key={p.slug}>
            <button
              type="button"
              onClick={() => onPick(p)}
              className="flex w-full items-center gap-3 px-2 py-1.5 text-left text-sm hover:bg-cream-100"
            >
              {p.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- 後台縮圖，不值得走圖片最佳化
                <img src={p.imageUrl} alt="" className="size-9 shrink-0 object-cover" />
              ) : (
                <span className="size-9 shrink-0 bg-cream-200" />
              )}
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {p.status !== 'ACTIVE' && <span className="shrink-0 text-xs text-sale">未上架</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ToolButton({
  label,
  onClick,
  disabled,
  pressed,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  pressed?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 min-w-8 items-center justify-center gap-1 px-1.5 text-ink-700 transition-colors hover:bg-cream-200 disabled:cursor-not-allowed disabled:text-taupe-300 disabled:hover:bg-transparent',
        pressed && 'bg-cream-200 text-ink-900',
      )}
    >
      {children}
    </button>
  )
}

const BLOCK_CLOSE = '(?:p|h[2-4]|ul|ol|blockquote|div|figure|table)'
const BLOCK_END = new RegExp(`</${BLOCK_CLOSE}>|<hr\\s*/?>`, 'gi')
const ENDS_WITH_BLOCK = new RegExp(`(?:</${BLOCK_CLOSE}>|<hr\\s*/?>)$`, 'i')

function insideTag(value: string, pos: number): boolean {
  return value.lastIndexOf('<', pos - 1) > value.lastIndexOf('>', pos - 1)
}

/** 行內標籤：游標在標籤的 < … > 之間就移到 > 後面，否則插進去的標籤會變成屬性文字 */
function outsideTag(value: string, pos: number): number {
  if (!insideTag(value, pos)) return pos
  const close = value.indexOf('>', pos)
  return close === -1 ? value.length : close + 1
}

/** 區塊：已經在區塊之間就原地插入，否則挪到游標所在區塊的結束標籤之後 */
function afterBlock(value: string, pos: number): number {
  if (!insideTag(value, pos)) {
    const before = value.slice(0, pos).trimEnd()
    if (before === '' || ENDS_WITH_BLOCK.test(before)) return pos
  }
  BLOCK_END.lastIndex = pos
  const match = BLOCK_END.exec(value)
  return match ? match.index + match[0].length : value.length
}
