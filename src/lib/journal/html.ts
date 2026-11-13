import sanitizeHtml from 'sanitize-html'

/**
 * 專欄文章內文的消毒與轉換。
 *
 * 內文是管理員直接貼上 / 上傳的 HTML（可能是別處排好版匯出的整份文件），
 * 資料庫存原文，**每次輸出到前台才消毒**。這支模組不碰資料庫也不是 server-only：
 * 後台編輯器的即時預覽跑的是同一支函式，看到什麼前台就是什麼。
 *
 * 跟商品描述（lib/catalog/description.ts）的差別：文章是自己寫的長文，
 * 允許清單放寬到表格、圖說、對齊與文字顏色；但 script、iframe、表單、事件屬性、
 * javascript: 網址、<style> 一律不收 —— 那些是 XSS 的入口，也會蓋掉全站樣式。
 */

/** 內文裡嵌入商品卡片的寫法：`{{product:商品slug}}`，獨立一段最好看。 */
const PRODUCT_SHORTCODE = /\{\{\s*product\s*:\s*([^\s{}]+?)\s*\}\}/gi

/** 列出內文用到的商品 slug（去重、保留出現順序），給伺服器一次查回來。 */
export function extractProductSlugs(html: string | null | undefined): string[] {
  if (!html) return []
  const seen = new Set<string>()
  for (const match of html.matchAll(PRODUCT_SHORTCODE)) seen.add(match[1]!)
  return [...seen]
}

/**
 * 回傳商品卡片的 HTML；null 代表這個 slug 不顯示（找不到、已下架）。
 * 回傳值會**原樣**插進輸出，所以實作必須自己跳脫所有資料庫來的字串（見 escapeHtml）。
 */
export type ProductCardRenderer = (slug: string) => string | null

/** 只允許這些 CSS 屬性，值也要長得像顏色 / 對齊，其餘 inline style 一律拔掉。 */
const COLOR = [/^#[0-9a-f]{3,8}$/i, /^rgba?\(\s*[\d.,\s%]+\)$/i, /^[a-z]+$/i]

const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'mark',
  'small',
  'sub',
  'sup',
  'span',
  'div',
  'h2',
  'h3',
  'h4',
  'ul',
  'ol',
  'li',
  'img',
  'figure',
  'figcaption',
  'a',
  'hr',
  'blockquote',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'caption',
]

/**
 * 消毒文章內文。
 *
 * `renderProduct` 給了才會把 `{{product:slug}}` 換成商品卡片；沒給就原文保留
 * （已經過跳脫，只是一段看得到的文字）。
 */
export function sanitizePostHtml(
  html: string | null | undefined,
  renderProduct?: ProductCardRenderer,
): string {
  if (!html) return ''

  return sanitizeHtml(bodyOf(html), {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan', 'scope'],
      '*': ['style'],
    },
    allowedStyles: {
      '*': {
        'text-align': [/^(left|right|center|justify|start|end)$/],
        color: COLOR,
        'background-color': COLOR,
        'font-weight': [/^(normal|bold|[1-9]00)$/],
        'font-style': [/^(normal|italic)$/],
        'text-decoration': [/^(none|underline|line-through)$/],
      },
    },
    // 圖片只收 http(s) 與站內相對路徑；data: 圖片動輒幾 MB，還能夾帶 SVG
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https'] },
    allowProtocolRelative: false,
    // 不在清單的標籤丟掉但保留文字；script/style/iframe 這類連內容一起丟（sanitize-html 預設的 nonTextTags）
    disallowedTagsMode: 'discard',
    transformTags: {
      // 頁面本身的 <h1> 是文章標題，內文的 h1 降一級，SEO 上一頁只該有一個 h1
      h1: 'h2',
      h5: 'h4',
      h6: 'h4',
      a: (tagName, attribs) => {
        const href = attribs.href ?? ''
        // 站內連結維持原分頁；站外的另開分頁並且不傳 referrer、不給權重
        const external = /^(https?:)?\/\//i.test(href)
        const next: Record<string, string> = { ...attribs }
        if (external) {
          next.target = '_blank'
          next.rel = 'noopener noreferrer nofollow'
        } else {
          delete next.target
          delete next.rel
        }
        return { tagName, attribs: next }
      },
      img: (tagName, attribs) => {
        const next: Record<string, string> = { ...attribs, alt: attribs.alt ?? '', loading: 'lazy' }
        // 只收站內絕對路徑（/uploads/…）與 http(s)。上傳的 HTML 檔常帶 `images/a.jpg` 這種
        // 相對路徑，指的是作者電腦上的檔案，前台必定破圖 —— 拿掉 src，下面的 exclusiveFilter 會整張移除
        if (!/^(\/(?!\/)|https?:\/\/)/i.test(next.src ?? '')) delete next.src
        // width / height 只用來讓瀏覽器預留版位（CSS 會把圖撐滿欄寬），不是乾淨的正整數就不給
        if (!isPositiveInt(next.width) || !isPositiveInt(next.height)) {
          delete next.width
          delete next.height
        }
        return { tagName, attribs: next }
      },
    },
    // 沒有 src 的圖片（被上面拿掉的、或 src 是 data:/javascript:）整張不輸出
    exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs.src,
    textFilter: renderProduct
      ? (text, tagName) =>
          // 連結裡面不能再放卡片（<a> 不能巢狀），留原文
          tagName === 'a'
            ? text
            : text.replace(PRODUCT_SHORTCODE, (_, slug: string) => renderProduct(unescapeSlug(slug)) ?? '')
      : undefined,
  })
    .replace(/<p>(?:\s|&nbsp;|&#160;|<br\s*\/?>)*<\/p>/gi, '')
    .trim()
}

/**
 * 上傳的若是整份 HTML 文件，只取 <body> 裡面那段。
 * <head> 裡的 <title>、<meta> 不在允許清單，丟掉沒關係；但它們的「文字」會被留下來
 * （disallowedTagsMode: discard 只丟標籤），所以要先切掉，免得標題字出現在內文最上面。
 */
function bodyOf(html: string): string {
  const match = /<body[^>]*>([\s\S]*?)(?:<\/body>|$)/i.exec(html)
  if (match) return match[1]!
  return html.replace(/<head[^>]*>[\s\S]*?<\/head>/i, '')
}

/** 列表摘要 / meta description 的備用：去掉標籤、短碼與多餘空白後取前 max 字。 */
export function plainTextExcerpt(html: string | null | undefined, max = 120): string {
  if (!html) return ''
  const text = sanitizeHtml(bodyOf(html), { allowedTags: [], allowedAttributes: {} })
    .replace(PRODUCT_SHORTCODE, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

/** 跳脫要插進 HTML 的字串（文字與雙引號屬性值兩用）。 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** textFilter 拿到的是已跳脫的文字；slug 本身不該含 &，但保險起見還原回去再查。 */
function unescapeSlug(slug: string): string {
  return slug.replace(/&amp;/g, '&')
}

function isPositiveInt(value: string | undefined): boolean {
  return value !== undefined && /^\d+$/.test(value) && Number(value) > 0
}
