/**
 * 尺寸對照表的「匯入計畫」與寫入，以及下載用的資料列。
 *
 * 流程：試算表 → parseFitRows（sheet.ts）→ planFitChart（這裡，比對資料庫現況）→
 * 預覽給人看 → applyFitChart 寫入。後台與 scripts/import-fit-chart.ts 都走這一條。
 *
 * 寫入規則（與先前的 CSV 匯入相同）：
 *  - 檔案裡出現的商品，適穿資料整份換成檔案的內容（檔案沒列、或範圍全空白的尺寸會被刪掉）；
 *  - 檔案沒出現的商品不動；
 *  - 任何一列有錯就整份不寫。
 *
 * 這支檔案不 import '@/lib/db'：資料庫連線由呼叫端傳進來，腳本用自己的 PrismaClient。
 */
import { createHash } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { sizeOfVariant } from '../recommend/fit'
import { RANGE_KEYS, type FitRow, type FitValues, type SheetIssue } from './sheet'

export interface FitInput extends FitValues {
  size: string
  note: string | null
}

export type ChangeKind = 'create' | 'update' | 'delete'

export interface FitChange {
  kind: ChangeKind
  productId: string
  productName: string
  size: string
  before: FitInput | null
  after: FitInput | null
}

export interface FitChartPlan {
  /** 檔案裡出現、且找得到的商品，以及它們寫入後應有的適穿資料 */
  products: { id: string; name: string; fits: FitInput[] }[]
  changes: FitChange[]
  counts: { products: number; create: number; update: number; delete: number; unchanged: number }
  errors: SheetIssue[]
  warnings: SheetIssue[]
  /**
   * 計畫內容的指紋。後台預覽時算一次、確認寫入時再算一次，不一樣就拒絕 ——
   * 代表預覽之後資料庫被別人改過，或上傳的不是同一個檔案。
   */
  fingerprint: string
}

const PRODUCT_COLUMN = '商品代號'
const SIZE_COLUMN = '尺寸'

function toInput(row: FitRow): FitInput {
  const values = Object.fromEntries(RANGE_KEYS.map((k) => [k, row[k]])) as FitValues
  return { size: row.size, ...values, note: row.note }
}

function sameFit(a: FitInput, b: FitInput): boolean {
  return a.note === b.note && RANGE_KEYS.every((k) => a[k] === b[k])
}

export async function planFitChart(
  db: PrismaClient,
  rows: FitRow[],
  parseErrors: SheetIssue[],
): Promise<FitChartPlan> {
  const errors = [...parseErrors]
  const warnings: SheetIssue[] = []

  const slugs = [...new Set(rows.flatMap((r) => (r.ref.kind === 'slug' ? [r.ref.slug] : [])))]
  const sourceIds = [...new Set(rows.flatMap((r) => (r.ref.kind === 'shopee' ? [`shopee-${r.ref.itemId}`] : [])))]
  const found = rows.length
    ? await db.product.findMany({
        where: { OR: [{ slug: { in: slugs } }, { sourceId: { in: sourceIds } }] },
        select: {
          id: true,
          slug: true,
          sourceId: true,
          name: true,
          status: true,
          variants: { where: { isActive: true }, select: { name: true } },
          fits: {
            select: {
              size: true,
              heightMin: true,
              heightMax: true,
              weightMin: true,
              weightMax: true,
              bustMin: true,
              bustMax: true,
              note: true,
            },
          },
        },
      })
    : []
  const bySlug = new Map(found.map((p) => [p.slug, p]))
  const bySource = new Map(found.flatMap((p) => (p.sourceId ? [[p.sourceId, p] as const] : [])))

  const grouped = new Map<string, { product: (typeof found)[number]; rows: FitRow[] }>()
  for (const row of rows) {
    const product = row.ref.kind === 'slug' ? bySlug.get(row.ref.slug) : bySource.get(`shopee-${row.ref.itemId}`)
    if (!product) {
      errors.push({ line: row.line, column: PRODUCT_COLUMN, message: `找不到商品「${row.refText}」` })
      continue
    }
    const group = grouped.get(product.id) ?? { product, rows: [] }
    group.rows.push(row)
    grouped.set(product.id, group)

    if (row.empty) continue
    if (product.status !== 'ACTIVE') {
      warnings.push({
        line: row.line,
        column: null,
        message: `「${product.name}」目前不是上架狀態，資料會寫入但首頁不會推薦`,
      })
    }
    const variantSizes = new Set(product.variants.map((v) => sizeOfVariant(v.name)).filter((s): s is string => !!s))
    if (row.size !== 'FREE' && variantSizes.size > 0 && !variantSizes.has(row.size)) {
      warnings.push({
        line: row.line,
        column: SIZE_COLUMN,
        message: `「${product.name}」的規格裡沒有 ${row.size}（有 ${[...variantSizes].join('、')}），這一列不會被推薦`,
      })
    }
  }

  const products: FitChartPlan['products'] = []
  const changes: FitChange[] = []
  let unchanged = 0
  for (const { product, rows: productRows } of grouped.values()) {
    const desired = productRows.filter((r) => !r.empty).map(toInput)
    products.push({ id: product.id, name: product.name, fits: desired })

    const existing = new Map(product.fits.map((f) => [f.size, f]))
    for (const after of desired) {
      const before = existing.get(after.size) ?? null
      existing.delete(after.size)
      if (!before) changes.push({ kind: 'create', productId: product.id, productName: product.name, size: after.size, before: null, after })
      else if (!sameFit(before, after)) changes.push({ kind: 'update', productId: product.id, productName: product.name, size: after.size, before, after })
      else unchanged++
    }
    for (const before of existing.values()) {
      changes.push({ kind: 'delete', productId: product.id, productName: product.name, size: before.size, before, after: null })
    }
  }

  errors.sort((a, b) => a.line - b.line)
  const counts = {
    products: products.length,
    create: changes.filter((c) => c.kind === 'create').length,
    update: changes.filter((c) => c.kind === 'update').length,
    delete: changes.filter((c) => c.kind === 'delete').length,
    unchanged,
  }
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ products, changes: changes.map(({ kind, productId, size }) => [kind, productId, size]) }))
    .digest('hex')
    .slice(0, 32)

  return { products, changes, counts, errors, warnings, fingerprint }
}

/** 照計畫寫入。呼叫前要先確認 plan.errors 是空的。一個交易：要嘛全部寫進去，要嘛全部不寫。 */
export async function applyFitChart(db: PrismaClient, plan: FitChartPlan): Promise<void> {
  if (plan.errors.length) throw new Error('計畫裡還有錯誤，不能寫入')
  await db.$transaction(
    plan.products.flatMap(({ id, fits }) => [
      db.productFit.deleteMany({ where: { productId: id } }),
      db.productFit.createMany({ data: fits.map((fit) => ({ productId: id, ...fit })) }),
    ]),
  )
}

// ---------------------------------------------------------------------------
// 下載
// ---------------------------------------------------------------------------

export interface ExportRow extends FitValues {
  slug: string
  name: string
  brand: string
  size: string
  inStock: boolean
  note: string | null
}

const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'FREE']
const sizeRank = (s: string) => {
  const i = SIZE_ORDER.indexOf(s)
  return i === -1 ? SIZE_ORDER.length : i
}

/**
 * 下載檔的內容：所有上架商品，每個尺寸一列，已經有的適穿範圍預先帶好。
 *
 * 尺寸從上架中規格的名稱推（白色M → M）；認不出尺寸的商品就是一列 FREE。
 * 資料庫裡已有、但規格已經沒有的尺寸也照樣列出來 —— 不列的話，重新上傳時它會被當成
 * 「檔案裡沒有」而刪掉，等於下載再上傳就靜靜地丟資料。
 */
export async function buildExportRows(db: PrismaClient): Promise<ExportRow[]> {
  const products = await db.product.findMany({
    where: { status: 'ACTIVE' },
    orderBy: [{ brand: { name: 'asc' } }, { name: 'asc' }],
    select: {
      slug: true,
      name: true,
      brand: { select: { name: true } },
      variants: { where: { isActive: true }, select: { name: true, stock: true, reservedStock: true } },
      fits: true,
    },
  })

  return products.flatMap((p) => {
    const stockBySize = new Map<string, boolean>()
    for (const v of p.variants) {
      const size = sizeOfVariant(v.name) ?? 'FREE'
      stockBySize.set(size, (stockBySize.get(size) ?? false) || v.stock - v.reservedStock > 0)
    }
    if (stockBySize.size === 0) stockBySize.set('FREE', false)
    const fitsBySize = new Map(p.fits.map((f) => [f.size, f]))
    const sizes = [...new Set([...stockBySize.keys(), ...fitsBySize.keys()])].sort((a, b) => sizeRank(a) - sizeRank(b) || a.localeCompare(b))

    return sizes.map((size) => {
      const fit = fitsBySize.get(size)
      return {
        slug: p.slug,
        name: p.name,
        brand: p.brand?.name ?? '',
        size,
        inStock: stockBySize.get(size) ?? false,
        heightMin: fit?.heightMin ?? null,
        heightMax: fit?.heightMax ?? null,
        weightMin: fit?.weightMin ?? null,
        weightMax: fit?.weightMax ?? null,
        bustMin: fit?.bustMin ?? null,
        bustMax: fit?.bustMax ?? null,
        note: fit?.note ?? null,
      }
    })
  })
}
