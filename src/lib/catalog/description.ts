import sanitizeHtml from 'sanitize-html'

/**
 * 商品描述 HTML 的正規化。
 *
 * `scripts/scrape-sagan.ts` 是把來源站的 `.product_feature` 原封不動抓下來的，
 * 81 支商品加起來帶了 4457 個 inline `style`（`font-family: Helvetica`、
 * `color: #333`、`background-color: #fff`、`margin: 0`、圖片 `width: 642.107px`）。
 * inline style 贏過任何 `@layer` 規則，所以不先拔掉它，`.prose-product`
 * 與頁面上的 utility class 一條都不會生效 —— 這是排版能改動的前提，不是額外的加分項。
 *
 * 順便把標籤收成允許清單，`SPEC.md` R2 記的「描述 HTML 未 sanitize」一併解掉。
 *
 * 刻意在算繪端做而不改資料庫：不需要 migration、DB 那欄仍是未經修改的正本、
 * 後台編輯器讀到的還是原文。中位數 35KB 的解析成本相對於一次 DB 查詢可以忽略。
 */
export function normalizeDescriptionHtml(html: string | null | undefined): string {
  if (!html) return ''

  const clean = sanitizeHtml(html, {
    allowedTags: [
      'p',
      'br',
      'strong',
      'b',
      'em',
      'i',
      'u',
      's',
      'h2',
      'h3',
      'h4',
      'ul',
      'ol',
      'li',
      'img',
      'a',
      'hr',
      'blockquote',
    ],
    // 一律不留 style / class / data-*。圖片的 width / height 屬性是例外，
    // 理由見下面 transformTags 裡的 img。
    // target / rel / loading 是 transformTags 補上的；allowedAttributes 在 transform
    // 之後才過濾，沒列進來會被自己的允許清單刷掉。
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'loading', 'width', 'height'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    // 預設的 'discard'：不在清單裡的標籤本身丟掉，但內文留著。
    // 來源站的 450 個 <span> 只是拿來塞 font-size: 12pt，正好該消失而字要留下。
    disallowedTagsMode: 'discard',
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer nofollow' },
      }),
      // 364 張圖裡有 358 張沒有 alt。補空 alt 讓輔助科技當裝飾圖跳過，
      // 而不是把 Shopee CDN 的檔名整串念出來。
      img: (tagName, attribs) => {
        const next: Record<string, string> = { ...attribs, alt: attribs.alt ?? '', loading: 'lazy' }
        /*
         * width / height 屬性要留著。真正該死的是 inline style 的 `width: 642.107px`
         * （把圖片釘在來源站的欄寬），而這兩個屬性配上 CSS 的 width:100% / height:auto
         * 只剩一個用途：讓瀏覽器先算出 aspect-ratio 預留版位，圖片載入時才不會版面跳動。
         * 拔掉它們的話高度會從 0 長到 850px，收摺的高度也會量錯。
         *
         * 只收乾淨的正整數 —— 拿不準的比例還不如不給。
         */
        if (!isPositiveInt(next.width) || !isPositiveInt(next.height)) {
          delete next.width
          delete next.height
        }
        return { tagName, attribs: next }
      },
    },
  })

  return dropSpacerParagraphs(clean).trim()
}

/**
 * 來源站用空段落當間距 —— 3715 個 <p> 裡有 1374 個是空的。
 * 留著它們段落節奏會被撐爛（每個空段落都吃到 .prose-product p 的 margin-block）。
 */
function dropSpacerParagraphs(html: string): string {
  return html.replace(/<p>(?:\s|&nbsp;|&#160;|<br\s*\/?>)*<\/p>/gi, '')
}

function isPositiveInt(value: string | undefined): boolean {
  return value !== undefined && /^\d+$/.test(value) && Number(value) > 0
}
