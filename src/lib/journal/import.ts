import { parseDocument, DomUtils } from 'htmlparser2'
import type { ChildNode, Element } from 'domhandler'
import { slugify } from '@/lib/utils'
import { parseTags, parseTaipeiDateTime } from './form'

/**
 * 「一個 HTML 檔就是一篇文章」的解析。
 *
 * 文章的所有欄位都從檔案本身讀，管理員不必再到表單一格一格填：
 *
 *   <title>                         → 標題（沒有就用內文第一個 <h1>）
 *   <meta name="description">       → 摘要
 *   <meta name="keywords">          → 標籤（逗號、頓號分隔）
 *   <meta name="slug">              → 網址代稱
 *   <meta name="status">            → published / draft（預設草稿）
 *   <meta name="date">              → 發布時間（台北時間；也收 article:published_time）
 *   <meta property="og:image">      → 封面（沒有就用內文開頭的第一張圖）
 *   <meta name="seo-title"> / <meta name="seo-description">
 *   <article lang="en">…</article>  → 譯文；裡面第一個 h1 是譯文標題，data-excerpt 是譯文摘要
 *   <div data-product="slug"></div> → 商品卡片（等同 {{product:slug}}）
 *
 * 這支只負責「讀」，不碰資料庫與磁碟，前後端都能用（也方便單元測試）；
 * 圖片的落地（base64、外部網址 → /uploads/posts/…）在 import-images.ts。
 * 輸出的 HTML 仍是原文，前台照常在輸出時消毒。
 */

export const IMPORT_LOCALES = ['en', 'ja', 'ko', 'fr'] as const

export type ParsedTranslation = {
  locale: (typeof IMPORT_LOCALES)[number]
  title: string
  excerpt: string | null
  bodyHtml: string
}

export type ParsedPost = {
  title: string
  /** 以下欄位 undefined = 檔案沒寫，更新既有文章時保留原值 */
  slug?: string
  excerpt?: string
  tags?: string[]
  status?: 'DRAFT' | 'PUBLISHED'
  publishedAt?: Date
  seoTitle?: string
  seoDescription?: string
  /** 封面圖的原始 src（可能是 data:、https: 或站內路徑），由 import-images 落地 */
  coverImageSrc?: string
  bodyHtml: string
  translations: ParsedTranslation[]
  warnings: string[]
}

export class PostImportError extends Error {}

export function parsePostHtml(raw: string): ParsedPost {
  const doc = parseDocument(raw, { decodeEntities: true, lowerCaseAttributeNames: true })
  const warnings: string[] = []

  const metas = DomUtils.getElementsByTagName('meta', doc, true)
  const meta = (...names: string[]): string | undefined => {
    for (const name of names) {
      const el = metas.find(
        (m) => (m.attribs.name ?? m.attribs.property ?? '').toLowerCase() === name,
      )
      const value = el?.attribs.content?.trim()
      if (value) return value
    }
    return undefined
  }

  // <title> 要在下面清掉 head 類標籤之前讀（沒有 <body> 的片段，title 就混在內文裡）
  const titleEl = DomUtils.findOne((e) => e.name === 'title', doc.children, true)
  const documentTitle = titleEl ? textOf(titleEl) : ''

  const body = DomUtils.findOne((el) => el.name === 'body', doc.children, true)
  const root: ChildNode[] = body ? body.children : doc.children

  // <head> 只取 meta / title，不留在內文；沒有 <body> 的片段也要把這些拿掉
  for (const el of DomUtils.findAll(
    (e) => ['head', 'title', 'meta', 'link', 'style', 'script', 'noscript'].includes(e.name),
    root,
  )) {
    DomUtils.removeElement(el)
  }

  // --- 譯文：<article lang="xx"> 整塊拿出來 --------------------------------------
  const translations: ParsedTranslation[] = []
  for (const el of DomUtils.findAll((e) => (e.name === 'article' || e.name === 'section') && !!e.attribs.lang, root)) {
    const lang = el.attribs.lang!.toLowerCase().split('-')[0]
    DomUtils.removeElement(el)
    if (lang === 'zh') {
      warnings.push('中文內文不用包在 <article lang="zh"> 裡，這一塊已略過')
      continue
    }
    if (!(IMPORT_LOCALES as readonly string[]).includes(lang)) {
      warnings.push(`不支援的語系 ${el.attribs.lang}，這段譯文已略過`)
      continue
    }
    if (translations.some((t) => t.locale === lang)) {
      warnings.push(`${lang} 譯文出現兩次，只用第一段`)
      continue
    }
    const heading = firstHeading(el.children)
    const title = (el.attribs['data-title'] ?? (heading ? textOf(heading) : '')).trim()
    if (heading && !el.attribs['data-title']) DomUtils.removeElement(heading)
    const bodyHtml = serialize(el.children)
    if (!title || !bodyHtml) {
      warnings.push(`${lang} 譯文缺標題或內文，已略過`)
      continue
    }
    translations.push({
      locale: lang as ParsedTranslation['locale'],
      title,
      excerpt: el.attribs['data-excerpt']?.trim() || null,
      bodyHtml,
    })
  }

  // --- 標題 ---------------------------------------------------------------------
  let title = documentTitle
  const h1 = DomUtils.findOne((e) => e.name === 'h1', root, true)
  if (h1) {
    // 內文的 h1 幾乎都是文章標題本身；頁面上已經有標題，留著會出現兩次
    if (!title) title = textOf(h1)
    if (textOf(h1) === title || isFirstContent(h1, root)) DomUtils.removeElement(h1)
  }
  if (!title) throw new PostImportError('找不到標題：請在檔案裡放 <title> 或第一個 <h1>')
  if (title.length > 200) throw new PostImportError('標題超過 200 字')

  // --- 商品卡片：<div data-product="slug"> → {{product:slug}} ---------------------
  for (const t of translations) t.bodyHtml = productTagsToShortcodes(t.bodyHtml)

  // --- 封面 ---------------------------------------------------------------------
  let coverImageSrc = meta('og:image', 'cover', 'twitter:image')
  if (!coverImageSrc) {
    // 沒指定封面就用第一張圖；它若是內文的第一個元素（典型的「題圖」），從內文拿掉免得出現兩次
    const img = DomUtils.findOne((e) => e.name === 'img' && !!e.attribs.src, root, true)
    if (img) {
      coverImageSrc = img.attribs.src
      if (isFirstContent(img, root)) removeWithEmptyParents(img)
    }
  }

  // --- 其他欄位 -----------------------------------------------------------------
  const statusRaw = meta('status')?.toLowerCase()
  let status: ParsedPost['status']
  if (statusRaw) {
    if (['published', 'publish', '發布', '已發布'].includes(statusRaw)) status = 'PUBLISHED'
    else if (['draft', '草稿'].includes(statusRaw)) status = 'DRAFT'
    else warnings.push(`看不懂 status「${statusRaw}」，維持草稿`)
  }

  const dateRaw = meta('date', 'article:published_time', 'published')
  let publishedAt: Date | undefined
  if (dateRaw) {
    publishedAt = parseImportDate(dateRaw) ?? undefined
    if (!publishedAt) warnings.push(`看不懂發布時間「${dateRaw}」，已略過`)
  }

  const slugRaw = meta('slug')
  const slug = slugRaw ? slugify(slugRaw) || undefined : undefined
  if (slugRaw && !slug) warnings.push(`網址代稱「${slugRaw}」只能有文字、數字和連字號，已略過`)

  const tagsRaw = meta('keywords', 'tags')
  const bodyHtml = productTagsToShortcodes(serialize(root))
  if (!bodyHtml) throw new PostImportError('內文是空的')

  return {
    title,
    slug,
    excerpt: meta('description')?.slice(0, 500),
    tags: tagsRaw ? parseTags(tagsRaw) : undefined,
    status,
    publishedAt,
    seoTitle: meta('seo-title')?.slice(0, 200),
    seoDescription: meta('seo-description')?.slice(0, 300),
    coverImageSrc,
    bodyHtml,
    translations,
    warnings,
  }
}

/** 「2026-11-20 20:00」「2026-11-20T20:00」當台北時間；帶時區的 ISO 照字面；只有日期 = 當天 00:00。 */
export function parseImportDate(value: string): Date | null {
  const v = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return parseTaipeiDateTime(`${v}T00:00`)
  const local = parseTaipeiDateTime(v.replace(' ', 'T'))
  if (local) return local
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(v)) {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

/** 把一段 HTML 裡所有 <img> 的 src 依對照表換掉；對照表沒有的保持原樣。回傳新 HTML。 */
export function rewriteImageSrcs(html: string, map: Map<string, string | null>): string {
  if (map.size === 0 || !html.includes('<img')) return html
  const doc = parseDocument(html, { decodeEntities: true })
  for (const img of DomUtils.getElementsByTagName('img', doc, true)) {
    const src = img.attribs.src
    if (src === undefined || !map.has(src)) continue
    const next = map.get(src)
    if (next === null) removeWithEmptyParents(img)
    else img.attribs.src = next!
  }
  return serialize(doc.children)
}

/** 一段 HTML 裡所有 <img> 的 src（去重）。 */
export function collectImageSrcs(html: string): string[] {
  if (!html.includes('<img')) return []
  const doc = parseDocument(html, { decodeEntities: true })
  const seen = new Set<string>()
  for (const img of DomUtils.getElementsByTagName('img', doc, true)) {
    if (img.attribs.src) seen.add(img.attribs.src)
  }
  return [...seen]
}

// ---------------------------------------------------------------------------

function serialize(nodes: ChildNode[]): string {
  return nodes.map((n) => DomUtils.getOuterHTML(n, { decodeEntities: true, encodeEntities: 'utf8' })).join('').trim()
}

function textOf(el: Element): string {
  return DomUtils.textContent(el).replace(/\s+/g, ' ').trim()
}

function firstHeading(nodes: ChildNode[]): Element | null {
  return DomUtils.findOne((e) => e.name === 'h1' || e.name === 'h2', nodes, true)
}

/** el 前面有沒有任何「看得到的內容」（文字或圖片）。沒有 = 它是內文的第一個東西。 */
function isFirstContent(el: Element, root: ChildNode[]): boolean {
  let found = false
  let blocked = false
  const walk = (nodes: ChildNode[]) => {
    for (const n of nodes) {
      if (found || blocked) return
      if (n === el) {
        found = true
        return
      }
      if (n.type === 'text' && n.data.trim()) {
        blocked = true
        return
      }
      if (DomUtils.isTag(n)) {
        if (n.name === 'img') {
          blocked = true
          return
        }
        walk(n.children)
      }
    }
  }
  walk(root)
  return found
}

/** 拿掉元素，順便拿掉因此變成空殼的 <p>/<figure>/<div>（包圖片的那層）。 */
function removeWithEmptyParents(el: Element): void {
  let parent = el.parent
  DomUtils.removeElement(el)
  while (parent && DomUtils.isTag(parent) && ['p', 'figure', 'div', 'a', 'picture'].includes(parent.name)) {
    const hasContent = parent.children.some(
      (c) => (c.type === 'text' && c.data.trim()) || (DomUtils.isTag(c) && c.name !== 'figcaption' && c.name !== 'br'),
    )
    if (hasContent) break
    const next = parent.parent
    DomUtils.removeElement(parent)
    parent = next
  }
}

function replaceWithHtml(el: Element, html: string): void {
  const fragment = parseDocument(html).children
  for (const node of fragment) DomUtils.prepend(el, node)
  DomUtils.removeElement(el)
}

function productTagsToShortcodes(html: string): string {
  if (!html.includes('data-product')) return html
  const doc = parseDocument(html, { decodeEntities: true })
  for (const el of DomUtils.findAll((e) => !!e.attribs['data-product'], doc.children)) {
    replaceWithHtml(el, `<p>{{product:${el.attribs['data-product']!.trim()}}}</p>`)
  }
  return serialize(doc.children)
}
