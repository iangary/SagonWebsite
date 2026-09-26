'use client'

import * as React from 'react'
import {
  Bold,
  Heading3,
  ImagePlus,
  List,
  Minus,
  Monitor,
  Pilcrow,
  Smartphone,
  Sparkles,
} from 'lucide-react'
import { Textarea } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { normalizeDescriptionHtml } from '@/lib/catalog/description'
import { WORTH_COLLAPSING_PX, COLLAPSED_MAX_PX } from '@/components/product/product-description'
import { cn } from '@/lib/utils'
import { uploadDescriptionImages } from './actions'

/**
 * 商品描述的 HTML 編輯器 + 即時預覽。
 *
 * 預覽跑的是和前台完全相同的 normalizeDescriptionHtml 與 `.prose-product`，
 * 所以來源站那堆 inline style 在這裡也一樣會被拔掉 —— 看到什麼，前台就是什麼。
 * 唯一的差別是字型：後台沒有載入前台的 Noto Serif TC 等網路字型，小標題會退回系統字。
 *
 * 工具列的插入走 `execCommand('insertText')` 而不是直接改 value：
 * 這樣 Ctrl+Z 還能一步步復原，改 value 的話整個復原紀錄會被清空。
 */

type Device = 'desktop' | 'mobile'

/** 前台描述欄寬 max-w-[42.5rem]；手機是 375px 扣掉左右各 24px 的內距 */
const PREVIEW_WIDTH: Record<Device, string> = { desktop: '42.5rem', mobile: '327px' }

export function DescriptionEditor({
  defaultValue = '',
  productId,
}: {
  defaultValue?: string
  /** 沒有 id（新增商品時）就不能上傳描述圖，因為檔案要放在商品資料夾底下 */
  productId?: string
}) {
  const { toast } = useToast()
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)
  const [value, setValue] = React.useState(defaultValue)
  const [device, setDevice] = React.useState<Device>('desktop')
  const [uploading, setUploading] = React.useState(false)
  /** 剛插入的圖片網址，預覽會捲過去並框起來，讓人一眼看到它落在哪 */
  const [highlight, setHighlight] = React.useState<string | null>(null)

  // 描述中位數 35KB，每個按鍵都重新 sanitize 會卡字；讓預覽慢一拍就好
  const deferred = React.useDeferredValue(value)
  const previewHtml = React.useMemo(() => normalizeDescriptionHtml(deferred), [deferred])

  /**
   * 用新文字取代目前選取範圍，保留復原紀錄。
   *
   * `at` 是插入前要先把游標挪過去的位置：來源站的原始碼八成是 `style="…"`，
   * 隨手一點游標就落在屬性值裡，照原位插入的標籤會變成屬性文字，
   * 被 sanitize 連同 style 一起丟掉 —— 上傳成功了畫面上卻什麼都沒有。
   */
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

  function wrap(tag: string, placeholder: string) {
    const text = selectedText() || placeholder
    replaceSelection(`<${tag}>${text}</${tag}>`, tag === 'strong' ? outsideTag : afterBlock)
  }

  function insertList() {
    const lines = (selectedText() || '項目一\n項目二')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    replaceSelection(`<ul>\n${lines.map((l) => `  <li>${l}</li>`).join('\n')}\n</ul>`, afterBlock)
  }

  function tidy() {
    const el = textareaRef.current
    if (!el) return
    const cleaned = prettify(normalizeDescriptionHtml(el.value))
    if (cleaned === el.value) {
      toast('格式已經是乾淨的了')
      return
    }
    el.focus()
    el.select()
    replaceSelection(cleaned)
    toast('已移除來源站的樣式，按 Ctrl+Z 可以還原；要按「儲存」才會寫入')
  }

  async function uploadImages(files: FileList) {
    if (!productId || files.length === 0) return
    const form = new FormData()
    form.set('productId', productId)
    for (const file of Array.from(files)) form.append('images', file)

    setUploading(true)
    const result = await uploadDescriptionImages(form)
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''

    for (const failure of result.failures ?? []) {
      toast(`${failure.filename}：${failure.reason}`, 'error')
    }
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
    setHighlight(result.images[0]!.url)
    toast(`已插入 ${result.images.length} 張圖片（預覽裡框起來的那張），記得按「儲存」`)
  }

  return (
    // 預覽欄寬 = 前台欄寬 42.5rem + 左右內距 2rem + 邊框；空間不夠時才讓它縮
    <div className="grid gap-4 xl:grid-cols-[minmax(20rem,1fr)_minmax(0,44.625rem)]">
      {/* 編輯區 */}
      <div className="flex min-w-0 flex-col">
        <div className="flex flex-wrap items-center gap-1 border border-b-0 border-cream-300 bg-cream-50 px-1.5 py-1">
          <ToolButton label="段落" onClick={() => wrap('p', '段落文字')}>
            <Pilcrow size={15} />
          </ToolButton>
          <ToolButton label="粗體" onClick={() => wrap('strong', '粗體文字')}>
            <Bold size={15} />
          </ToolButton>
          <ToolButton label="小標題" onClick={() => wrap('h3', '小標題')}>
            <Heading3 size={15} />
          </ToolButton>
          <ToolButton label="清單（每行一項）" onClick={insertList}>
            <List size={15} />
          </ToolButton>
          <ToolButton label="分隔線" onClick={() => replaceSelection('\n<hr>\n', afterBlock)}>
            <Minus size={15} />
          </ToolButton>
          <ToolButton
            label={productId ? '插入圖片' : '建立商品後才能插入圖片'}
            disabled={!productId || uploading}
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus size={15} />
            <span className="text-xs">{uploading ? '上傳中…' : '圖片'}</span>
          </ToolButton>

          <span className="mx-1 h-4 w-px bg-cream-300" aria-hidden />

          <ToolButton label="移除來源站的 inline style，讓原始碼好讀" onClick={tidy}>
            <Sparkles size={15} />
            <span className="text-xs">整理格式</span>
          </ToolButton>

          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            multiple
            hidden
            onChange={(e) => e.target.files && uploadImages(e.target.files)}
          />
        </div>

        <Textarea
          ref={textareaRef}
          id="descriptionHtml"
          name="descriptionHtml"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-[36rem] resize-y font-mono text-xs leading-relaxed xl:h-[42rem]"
          placeholder="<p>材質：100% 純棉</p>"
          spellCheck={false}
        />
      </div>

      {/* 預覽區 */}
      <div className="flex min-w-0 flex-col">
        <div className="flex items-center justify-between border border-b-0 border-cream-300 bg-cream-50 px-3 py-1">
          <span className="text-xs text-taupe-600">前台預覽</span>
          <div className="flex gap-1" role="group" aria-label="預覽寬度">
            <ToolButton
              label="桌機寬度"
              pressed={device === 'desktop'}
              onClick={() => setDevice('desktop')}
            >
              <Monitor size={15} />
            </ToolButton>
            <ToolButton
              label="手機寬度"
              pressed={device === 'mobile'}
              onClick={() => setDevice('mobile')}
            >
              <Smartphone size={15} />
            </ToolButton>
          </div>
        </div>

        <div className="h-[36rem] overflow-auto border border-cream-300 bg-cream-50 px-4 py-8 xl:h-[42rem]">
          {previewHtml ? (
            <div className="mx-auto" style={{ maxWidth: PREVIEW_WIDTH[device] }}>
              <p className="text-center text-lg tracking-[0.12em] text-ink-900">商品描述</p>
              <PreviewBody
                html={previewHtml}
                mobile={device === 'mobile'}
                highlight={highlight}
              />
            </div>
          ) : (
            <p className="text-center text-sm text-taupe-500">
              描述是空的 —— 前台不會出現「商品描述」這一段。
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * 預覽內文，加上前台收摺位置的標記。
 * 前台超過一定高度會先收起來、顯示「展開」按鈕 —— 標記以上就是顧客第一眼看到的部分。
 */
function PreviewBody({
  html,
  mobile,
  highlight,
}: {
  html: string
  mobile: boolean
  highlight: string | null
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [collapsible, setCollapsible] = React.useState(false)

  /*
   * 預覽是 deferred 的，新圖片要等下一輪 html 更新才會出現，所以跟著 html 一起看。
   * 用 ref 記住標過哪一張：之後繼續打字 html 會一直變，不該每次都把預覽捲回那張圖。
   */
  const shown = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!highlight || shown.current === highlight) return
    const img = Array.from(ref.current?.querySelectorAll('img') ?? []).find(
      (i) => i.getAttribute('src') === highlight,
    )
    if (!img) return
    shown.current = highlight
    img.scrollIntoView({ block: 'center', behavior: 'smooth' })
    img.style.outline = '3px solid var(--color-sale)'
    img.style.outlineOffset = '4px'
    setTimeout(() => {
      img.style.outline = ''
      img.style.outlineOffset = ''
    }, 3000)
  }, [html, highlight])

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setCollapsible(el.scrollHeight > WORTH_COLLAPSING_PX)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [html])

  return (
    <div className="relative mt-8">
      <div
        ref={ref}
        className="prose-product"
        // 手機版字級：前台靠 media query 切換，後台視窗寬，得自己指定
        style={mobile ? { fontSize: '0.9375rem' } : undefined}
        // 已經過 normalizeDescriptionHtml 的允許清單過濾
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {collapsible && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 border-t border-dashed border-sale"
          style={{ top: COLLAPSED_MAX_PX }}
        >
          <span className="absolute right-0 -top-5 bg-cream-50 px-1 text-[10px] text-sale">
            前台預設收摺在這裡，以下要按「展開」才看得到
          </span>
        </div>
      )}
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

const BLOCK_END = /<\/(?:p|h[2-4]|ul|ol|blockquote|div)>|<hr\s*\/?>/gi

function insideTag(value: string, pos: number): boolean {
  return value.lastIndexOf('<', pos - 1) > value.lastIndexOf('>', pos - 1)
}

/** 行內標籤（粗體）：游標在標籤裡的話移到該標籤的 `>` 後面 */
function outsideTag(value: string, pos: number): number {
  if (!insideTag(value, pos)) return pos
  const close = value.indexOf('>', pos)
  return close === -1 ? value.length : close + 1
}

/**
 * 區塊（圖片、清單、分隔線、段落）：已經在區塊之間就原地插入，
 * 否則挪到游標所在區塊的結束標籤之後，找不到就放最後面。
 */
function afterBlock(value: string, pos: number): number {
  if (!insideTag(value, pos)) {
    const before = value.slice(0, pos).trimEnd()
    if (before === '' || /(?:<\/(?:p|h[2-4]|ul|ol|blockquote|div)>|<hr\s*\/?>)$/i.test(before)) {
      return pos
    }
  }
  BLOCK_END.lastIndex = pos
  const match = BLOCK_END.exec(value)
  return match ? match.index + match[0].length : value.length
}

/** 區塊標籤各佔一行，讓整理過的原始碼能讀、也能對著預覽找段落 */
function prettify(html: string): string {
  return html
    .replace(/<\/(p|h2|h3|h4|li|blockquote)>\s*/gi, '</$1>\n')
    .replace(/\s*<(ul|ol)>\s*/gi, '\n<$1>\n')
    .replace(/\s*<\/(ul|ol)>\s*/gi, '\n</$1>\n')
    .replace(/\s*<hr\s*\/?>\s*/gi, '\n<hr>\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}
