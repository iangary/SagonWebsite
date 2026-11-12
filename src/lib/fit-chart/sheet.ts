/**
 * 尺寸對照表（商品適穿範圍）的試算表格式：欄位定義、解析、逐列驗證。純函式，不碰資料庫。
 *
 * 後台「尺寸對照表」頁（src/app/admin/fit-chart）與 scripts/import-fit-chart.ts 共用這一份，
 * 兩條路的驗證規則才會一模一樣。
 *
 * 表格的一列 = 一件商品的一個尺寸。後台下載的檔案已經把每件上架商品、每個尺寸都列好，
 * 只要填範圍；範圍六格全空白的列代表「這個尺寸沒有資料」，不是錯誤。
 */

// ---------------------------------------------------------------------------
// 欄位
// ---------------------------------------------------------------------------

export type ColumnKey =
  | 'product'
  | 'name'
  | 'brand'
  | 'size'
  | 'inStock'
  | 'heightMin'
  | 'heightMax'
  | 'weightMin'
  | 'weightMax'
  | 'bustMin'
  | 'bustMax'
  | 'note'

export interface ColumnDef {
  key: ColumnKey
  /** 下載檔的表頭 */
  title: string
  /** 下載檔的欄寬（字元） */
  width: number
  /** 識別用、不要改的欄位：下載檔標灰底 */
  locked?: boolean
  /** 只是給人看的參考欄位，匯入時忽略 */
  reference?: boolean
}

export const COLUMNS: ColumnDef[] = [
  { key: 'product', title: '商品代號', width: 46, locked: true },
  { key: 'name', title: '商品名稱（參考）', width: 44, locked: true, reference: true },
  { key: 'brand', title: '品牌（參考）', width: 14, locked: true, reference: true },
  { key: 'size', title: '尺寸', width: 8, locked: true },
  { key: 'inStock', title: '有現貨（參考）', width: 12, locked: true, reference: true },
  { key: 'heightMin', title: '身高下限(cm)', width: 13 },
  { key: 'heightMax', title: '身高上限(cm)', width: 13 },
  { key: 'weightMin', title: '體重下限(kg)', width: 13 },
  { key: 'weightMax', title: '體重上限(kg)', width: 13 },
  { key: 'bustMin', title: '胸圍下限(cm)', width: 13 },
  { key: 'bustMax', title: '胸圍上限(cm)', width: 13 },
  { key: 'note', title: '備註', width: 30 },
]

export const RANGE_KEYS = ['heightMin', 'heightMax', 'weightMin', 'weightMax', 'bustMin', 'bustMax'] as const
export type RangeKey = (typeof RANGE_KEYS)[number]

/** 標題比對時先拿掉空白與括號內的單位，所以「身高下限(cm)」「身高下限」「身高 下限（公分）」都認得 */
const normalizeHeader = (h: string) =>
  h
    .normalize('NFKC')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()

/** 各欄可接受的標題（含舊版 CSV 範本的「商品（網址或代號）」） */
const HEADER_ALIASES: Record<ColumnKey, string[]> = {
  product: ['商品代號', '商品', '商品網址', '商品網址或代號', '網址', 'slug', 'product'],
  name: ['商品名稱'],
  brand: ['品牌'],
  size: ['尺寸', '尺碼', 'size'],
  inStock: ['有現貨', '現貨'],
  heightMin: ['身高下限', '身高最小', '最低身高', 'heightmin'],
  heightMax: ['身高上限', '身高最大', '最高身高', 'heightmax'],
  weightMin: ['體重下限', '體重最小', '最低體重', 'weightmin'],
  weightMax: ['體重上限', '體重最大', '最高體重', 'weightmax'],
  bustMin: ['胸圍下限', '胸圍最小', 'bustmin'],
  bustMax: ['胸圍上限', '胸圍最大', 'bustmax'],
  note: ['備註', 'note'],
}

const titleOf = (key: ColumnKey) => COLUMNS.find((c) => c.key === key)!.title

function mapHeader(header: string[]): Map<ColumnKey, number> {
  const map = new Map<ColumnKey, number>()
  header.forEach((raw, index) => {
    const h = normalizeHeader(raw)
    for (const [key, aliases] of Object.entries(HEADER_ALIASES) as [ColumnKey, string[]][]) {
      if (!map.has(key) && aliases.includes(h)) map.set(key, index)
    }
  })
  return map
}

// ---------------------------------------------------------------------------
// 讀檔：CSV（含引號跳脫）或 Tab 分隔。xlsx 由呼叫端讀成 string[][] 再交給 parseFitRows。
// ---------------------------------------------------------------------------

export function parseDelimited(text: string): string[][] {
  const body = text.replace(/^﻿/, '')
  const firstLine = body.slice(0, body.search(/\r?\n|$/))
  const delimiter = firstLine.includes('\t') ? '\t' : ','

  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') {
        quoted = false
      } else {
        cell += ch
      }
    } else if (ch === '"' && cell === '') {
      quoted = true
    } else if (ch === delimiter) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += ch
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

// ---------------------------------------------------------------------------
// 值的正規化
// ---------------------------------------------------------------------------

/** 單一尺寸的各種寫法都收成 FREE；其他轉大寫，2XL 統一寫成 XXL */
export function normalizeSize(raw: string): string {
  const s = raw.normalize('NFKC').trim().toUpperCase().replace(/\s+/g, '')
  if (['', 'F', 'FREE', 'FREESIZE', 'ONESIZE', 'OS', '單一尺寸', '均碼', '單一規格', '不分尺寸'].includes(s)) {
    return 'FREE'
  }
  if (s === '2XL') return 'XXL'
  if (s === '3XL') return 'XXXL'
  return s
}

export type ProductRef = { kind: 'slug'; slug: string } | { kind: 'shopee'; itemId: string }

/** 把商品欄的內容認成官網 slug 或蝦皮商品編號 */
export function parseProductRef(raw: string): ProductRef | null {
  const value = raw.trim()
  if (!value) return null

  if (/^https?:\/\//i.test(value)) {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      return null
    }
    if (/shopee\./i.test(url.hostname)) {
      const itemId =
        /\/product\/\d+\/(\d+)/.exec(url.pathname)?.[1] ?? /-i\.\d+\.(\d+)/.exec(url.pathname)?.[1]
      return itemId ? { kind: 'shopee', itemId } : null
    }
    // 官網：/product/<slug> 或 /en/product/<slug>
    const slug = /\/product\/([^/]+)\/?$/.exec(url.pathname)?.[1]
    return slug ? { kind: 'slug', slug: decodeURIComponent(slug) } : null
  }

  if (/^\d{6,}$/.test(value)) return { kind: 'shopee', itemId: value }
  return { kind: 'slug', slug: value }
}

/** 合理範圍。超出的多半是單位填錯（公尺、公克、英吋），不收 */
const LIMITS: Record<RangeKey, readonly [number, number]> = {
  heightMin: [80, 220],
  heightMax: [80, 220],
  weightMin: [15, 200],
  weightMax: [15, 200],
  bustMin: [40, 200],
  bustMax: [40, 200],
}

// ---------------------------------------------------------------------------
// 逐列解析
// ---------------------------------------------------------------------------

export type FitValues = Record<RangeKey, number | null>

export interface FitRow extends FitValues {
  /** 試算表上的列號（含表頭，所以資料從第 2 列開始） */
  line: number
  ref: ProductRef
  refText: string
  size: string
  note: string | null
  /** 範圍六格全空白：這個尺寸沒有資料（匯入時不建立、原有的會被刪掉） */
  empty: boolean
}

export interface SheetIssue {
  line: number
  /** 出錯的欄位標題；整列的問題是 null */
  column: string | null
  message: string
}

export function formatIssue(issue: SheetIssue): string {
  return `第 ${issue.line} 列${issue.column ? `「${issue.column}」欄` : ''}：${issue.message}`
}

export interface ParseResult {
  rows: FitRow[]
  errors: SheetIssue[]
}

export function parseFitRows(table: string[][]): ParseResult {
  const errors: SheetIssue[] = []
  const nonEmpty = table.filter((r) => r.some((c) => String(c ?? '').trim() !== ''))
  if (nonEmpty.length === 0) return { rows: [], errors: [{ line: 1, column: null, message: '檔案是空的' }] }

  const columns = mapHeader(table[0].map((c) => String(c ?? '')))
  for (const key of ['product', 'size'] as const) {
    if (!columns.has(key)) {
      errors.push({
        line: 1,
        column: null,
        message: `找不到「${titleOf(key)}」欄。第一列要是欄位標題，請用後台下載的檔案填寫。`,
      })
    }
  }
  if (errors.length) return { rows: [], errors }

  const get = (row: string[], key: ColumnKey) => {
    const index = columns.get(key)
    return index === undefined ? '' : String(row[index] ?? '').normalize('NFKC').trim()
  }

  const rows: FitRow[] = []
  const seen = new Map<string, number>()

  table.slice(1).forEach((row, i) => {
    const line = i + 2
    if (!row.some((c) => String(c ?? '').trim() !== '')) return // 空白列略過

    const rowErrors: SheetIssue[] = []
    const fail = (key: ColumnKey | null, message: string) =>
      rowErrors.push({ line, column: key ? titleOf(key) : null, message })

    const note = get(row, 'note')
    if (note.startsWith('【示範】')) {
      errors.push({ line, column: null, message: '範本的示範資料，請刪掉這一列' })
      return
    }

    const refText = get(row, 'product')
    const ref = parseProductRef(refText)
    if (!ref) fail('product', refText ? `認不出商品「${refText}」` : '商品代號是空的')

    const values = {} as FitValues
    for (const key of RANGE_KEYS) {
      const raw = get(row, key).replace(/(cm|kg|公分|公斤)$/i, '').trim()
      values[key] = null
      if (raw === '') continue
      const n = Number(raw)
      if (!Number.isFinite(n)) {
        fail(key, `「${raw}」不是數字`)
        continue
      }
      const [lo, hi] = LIMITS[key]
      if (n < lo || n > hi) {
        fail(key, `${n} 不在合理範圍 ${lo}～${hi}（單位填錯了嗎？）`)
        continue
      }
      values[key] = Math.round(n)
    }

    for (const [min, max, label] of [
      ['heightMin', 'heightMax', '身高'],
      ['weightMin', 'weightMax', '體重'],
      ['bustMin', 'bustMax', '胸圍'],
    ] as const) {
      const lo = values[min]
      const hi = values[max]
      if (lo !== null && hi !== null && lo > hi) fail(min, `${label}下限 ${lo} 大於上限 ${hi}`)
    }

    const size = normalizeSize(get(row, 'size'))
    if (ref) {
      const key = `${ref.kind}:${ref.kind === 'slug' ? ref.slug : ref.itemId}:${size}`
      const previous = seen.get(key)
      if (previous) fail('size', `與第 ${previous} 列是同一件商品的同一個尺寸（${size}）`)
      else seen.set(key, line)
    }

    if (rowErrors.length || !ref) {
      errors.push(...rowErrors)
      return
    }
    rows.push({
      line,
      ref,
      refText,
      size,
      ...values,
      note: note || null,
      empty: RANGE_KEYS.every((k) => values[k] === null),
    })
  })

  return { rows, errors }
}
