/**
 * 匯入「商品適穿範圍」對照表（首頁尺寸推薦的資料來源，見 prisma/schema.prisma 的 ProductFit）。
 *
 * 範本：docs/recommend/fit-chart-template.csv —— 用 Excel 或 Google 試算表打開來填，
 * 存檔時選「CSV UTF-8（逗號分隔）」。直接從試算表複製貼到文字檔（Tab 分隔）也吃。
 * 不收 .xlsx：正式站要在 worker 容器裡跑這支，那裡沒有讀 Excel 的套件（同 import-members.ts）。
 *
 * 用法：
 *   npx tsx scripts/import-fit-chart.ts docs/recommend/fit-chart.csv --dry-run   只檢查、列出會寫入什麼
 *   npx tsx scripts/import-fit-chart.ts docs/recommend/fit-chart.csv             寫進資料庫
 *
 * 正式站（比照 docs/deploy.md §7.10）：
 *   scp scripts/import-fit-chart.ts fit-chart.csv root@103.1.221.67:/srv/sagon/seed-data/
 *   ssh root@103.1.221.67 'cd /srv/sagon && docker compose -f docker-compose.prod.yml run --rm --no-deps \
 *     -v /srv/sagon/seed-data:/app/import:ro worker npx tsx import/import-fit-chart.ts import/fit-chart.csv --dry-run'
 *
 * 每一列 = 一件商品的一個尺寸。商品欄可以填：
 *   官網網址  https://chenkuanyi.com.tw/product/<代號>
 *   蝦皮網址  https://shopee.tw/product/<賣場>/<商品>、https://shopee.tw/xxx-i.<賣場>.<商品>
 *   商品代號  官網網址最後那一段（slug），或蝦皮的商品編號
 *
 * 寫入規則：檔案裡出現的商品，資料庫裡它的適穿資料整份換成檔案的內容（刪掉檔案沒列的尺寸）；
 * 檔案沒出現的商品不動。所以可以分批匯入，也可以重複執行。
 * 任何一列有錯就整份不寫，先把錯誤列出來 —— 寫一半比不寫更難收拾。
 *
 * 這支檔案只能依賴 Node 內建模組與 @prisma/client，才能單獨複製到正式站執行。
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'

// ---------------------------------------------------------------------------
// 讀檔：CSV（含引號跳脫）或 Tab 分隔
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
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

// ---------------------------------------------------------------------------
// 欄位
// ---------------------------------------------------------------------------

type ColumnKey =
  | 'product'
  | 'size'
  | 'heightMin'
  | 'heightMax'
  | 'weightMin'
  | 'weightMax'
  | 'bustMin'
  | 'bustMax'
  | 'note'

/** 標題比對時先拿掉空白與括號內的單位，所以「身高下限(cm)」「身高下限」「身高 下限（公分）」都認得 */
const normalizeHeader = (h: string) =>
  h
    .normalize('NFKC')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()

const HEADER_ALIASES: Record<ColumnKey, string[]> = {
  product: ['商品', '商品網址', '商品網址或代號', '網址', 'slug', 'product'],
  size: ['尺寸', '尺碼', 'size'],
  heightMin: ['身高下限', '身高最小', '最低身高', 'heightmin'],
  heightMax: ['身高上限', '身高最大', '最高身高', 'heightmax'],
  weightMin: ['體重下限', '體重最小', '最低體重', 'weightmin'],
  weightMax: ['體重上限', '體重最大', '最高體重', 'weightmax'],
  bustMin: ['胸圍下限', '胸圍最小', 'bustmin'],
  bustMax: ['胸圍上限', '胸圍最大', 'bustmax'],
  note: ['備註', 'note'],
}

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
const LIMITS = {
  height: [80, 220],
  weight: [15, 200],
  bust: [40, 200],
} as const

export interface FitRow {
  line: number
  ref: ProductRef
  refText: string
  size: string
  heightMin: number | null
  heightMax: number | null
  weightMin: number | null
  weightMax: number | null
  bustMin: number | null
  bustMax: number | null
  note: string | null
}

export interface ParseResult {
  rows: FitRow[]
  errors: string[]
}

export function parseFitRows(table: string[][]): ParseResult {
  const errors: string[] = []
  if (table.length === 0) return { rows: [], errors: ['檔案是空的'] }

  const columns = mapHeader(table[0])
  for (const key of ['product', 'size'] as const) {
    if (!columns.has(key)) {
      errors.push(`找不到「${HEADER_ALIASES[key][0]}」欄。第一列要是欄位標題，請照範本的標題填。`)
    }
  }
  if (errors.length) return { rows: [], errors }

  const get = (row: string[], key: ColumnKey) => {
    const index = columns.get(key)
    return index === undefined ? '' : (row[index] ?? '').normalize('NFKC').trim()
  }

  const rows: FitRow[] = []
  const seen = new Map<string, number>()

  table.slice(1).forEach((row, i) => {
    const line = i + 2
    const problems: string[] = []
    const note = get(row, 'note')

    if (note.startsWith('【示範】')) {
      errors.push(`第 ${line} 列：範本的示範資料，請刪掉這一列`)
      return
    }

    const refText = get(row, 'product')
    const ref = parseProductRef(refText)
    if (!ref) problems.push(`認不出商品「${refText || '（空白）'}」`)

    const number = (key: ColumnKey, label: string, [lo, hi]: readonly [number, number]) => {
      const raw = get(row, key).replace(/(cm|kg|公分|公斤)$/i, '').trim()
      if (raw === '') return null
      const n = Number(raw)
      if (!Number.isFinite(n)) {
        problems.push(`${label}「${raw}」不是數字`)
        return null
      }
      if (n < lo || n > hi) {
        problems.push(`${label} ${n} 不在合理範圍 ${lo}～${hi}（單位填錯了嗎？）`)
        return null
      }
      return Math.round(n)
    }

    const fit = {
      heightMin: number('heightMin', '身高下限', LIMITS.height),
      heightMax: number('heightMax', '身高上限', LIMITS.height),
      weightMin: number('weightMin', '體重下限', LIMITS.weight),
      weightMax: number('weightMax', '體重上限', LIMITS.weight),
      bustMin: number('bustMin', '胸圍下限', LIMITS.bust),
      bustMax: number('bustMax', '胸圍上限', LIMITS.bust),
    }

    for (const [min, max, label] of [
      [fit.heightMin, fit.heightMax, '身高'],
      [fit.weightMin, fit.weightMax, '體重'],
      [fit.bustMin, fit.bustMax, '胸圍'],
    ] as const) {
      if (min !== null && max !== null && min > max) problems.push(`${label}下限 ${min} 大於上限 ${max}`)
    }
    if (Object.values(fit).every((v) => v === null)) {
      problems.push('身高、體重、胸圍至少要填一項範圍')
    }

    const size = normalizeSize(get(row, 'size'))
    if (ref) {
      const key = `${ref.kind}:${ref.kind === 'slug' ? ref.slug : ref.itemId}:${size}`
      const previous = seen.get(key)
      if (previous) problems.push(`與第 ${previous} 列是同一件商品的同一個尺寸（${size}）`)
      else seen.set(key, line)
    }

    if (problems.length || !ref) {
      errors.push(`第 ${line} 列：${problems.join('；')}`)
      return
    }
    rows.push({ line, ref, refText, size, ...fit, note: note || null })
  })

  return { rows, errors }
}

// ---------------------------------------------------------------------------
// 寫入資料庫
// ---------------------------------------------------------------------------

/** 規格名稱裡的尺寸字樣（與 src/lib/recommend/fit.ts 的 sizeOfVariant 同一套規則） */
const SIZE_TOKEN = /(?:^|[^A-Za-z])(XXXL|3XL|XXL|2XL|XL|XS|S|M|L|F|FREE)(?:[^A-Za-z]|$)/i

async function main() {
  const file = process.argv[2]
  const dryRun = process.argv.includes('--dry-run')
  if (!file) {
    console.error('用法：npx tsx scripts/import-fit-chart.ts <對照表.csv> [--dry-run]')
    process.exit(1)
  }

  const { rows, errors } = parseFitRows(parseDelimited(readFileSync(file, 'utf8')))

  const db = new PrismaClient()
  try {
    const slugs = [...new Set(rows.flatMap((r) => (r.ref.kind === 'slug' ? [r.ref.slug] : [])))]
    const sourceIds = [
      ...new Set(rows.flatMap((r) => (r.ref.kind === 'shopee' ? [`shopee-${r.ref.itemId}`] : []))),
    ]
    const products = await db.product.findMany({
      where: { OR: [{ slug: { in: slugs } }, { sourceId: { in: sourceIds } }] },
      select: {
        id: true,
        slug: true,
        sourceId: true,
        name: true,
        status: true,
        variants: { where: { isActive: true }, select: { name: true } },
      },
    })
    const bySlug = new Map(products.map((p) => [p.slug, p]))
    const bySource = new Map(products.flatMap((p) => (p.sourceId ? [[p.sourceId, p] as const] : [])))

    const warnings: string[] = []
    const grouped = new Map<string, { product: (typeof products)[number]; rows: FitRow[] }>()
    for (const row of rows) {
      const product =
        row.ref.kind === 'slug' ? bySlug.get(row.ref.slug) : bySource.get(`shopee-${row.ref.itemId}`)
      if (!product) {
        errors.push(`第 ${row.line} 列：找不到商品「${row.refText}」`)
        continue
      }
      if (product.status !== 'ACTIVE') {
        warnings.push(`第 ${row.line} 列：「${product.name}」目前不是上架狀態，資料會寫入但首頁不會推薦`)
      }
      const variantSizes = new Set(
        product.variants.flatMap((v) => {
          const m = SIZE_TOKEN.exec(v.name)
          return m ? [normalizeSize(m[1])] : []
        }),
      )
      if (row.size !== 'FREE' && variantSizes.size > 0 && !variantSizes.has(row.size)) {
        warnings.push(
          `第 ${row.line} 列：「${product.name}」的規格裡沒有 ${row.size}（有 ${[...variantSizes].join('、')}），這一列不會被推薦`,
        )
      }
      if (row.size === 'FREE' && variantSizes.size > 1) {
        warnings.push(
          `第 ${row.line} 列：「${product.name}」有分尺寸（${[...variantSizes].join('、')}），填 FREE 會套用到所有尺寸`,
        )
      }
      const group = grouped.get(product.id) ?? { product, rows: [] }
      group.rows.push(row)
      grouped.set(product.id, group)
    }

    for (const w of warnings) console.warn(`⚠ ${w}`)
    if (errors.length) {
      for (const e of errors) console.error(`✗ ${e}`)
      console.error(`\n有 ${errors.length} 個錯誤，整份都沒有寫入。改好再重跑。`)
      process.exitCode = 1
      return
    }

    for (const { product, rows: fits } of grouped.values()) {
      console.log(`${product.name}：${fits.map((f) => f.size).join('、')}`)
    }
    console.log(`\n共 ${grouped.size} 件商品、${rows.length} 個尺寸。`)
    if (dryRun) {
      console.log('（--dry-run：沒有寫入）')
      return
    }

    await db.$transaction(
      [...grouped.values()].flatMap(({ product, rows: fits }) => [
        db.productFit.deleteMany({ where: { productId: product.id } }),
        db.productFit.createMany({
          data: fits.map(({ size, heightMin, heightMax, weightMin, weightMax, bustMin, bustMax, note }) => ({
            productId: product.id,
            size,
            heightMin,
            heightMax,
            weightMin,
            weightMax,
            bustMin,
            bustMax,
            note,
          })),
        }),
      ]),
    )
    console.log('已寫入。首頁最晚 5 分鐘後（ISR 重新產生）會出現尺寸推薦。')
  } finally {
    await db.$disconnect()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
