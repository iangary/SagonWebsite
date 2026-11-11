/**
 * 把蝦皮賣家中心「批次更新」匯出的三份 Excel 轉成 seed 用的商品資料，並把圖片下載到本機。
 *
 * 蝦皮賣家中心 → 商品 → 批次工具 → 批次更新，分別下載「基本資訊」「銷售資訊」「媒體資訊」：
 *   mass_update_basic_info_<shopId>_<時間>.xlsx   商品名稱、描述
 *   mass_update_sales_info_<shopId>_<時間>.xlsx   規格、價格、庫存（一列一個規格）
 *   mass_update_media_info_<shopId>_<時間>.xlsx   分類、商品圖、規格圖、尺寸表
 * 三份放在同一個資料夾，同類型有好幾份時取檔名最新的那份。
 *
 * 用法：
 *   npm run import:shopee -- "E:\我的雲端硬碟\莎岡選品店商品資料"
 *   npm run seed
 *
 * 產出：
 *   prisma/seed-data/shopee.json            給 prisma/seed.ts 讀
 *   public/uploads/shopee/<商品ID>/<檔名>.webp   商品圖與描述內的圖
 *
 * 檔名依內容命名：<商品名>-<用途>-<識別碼>.webp，例如
 *   ullala韓國睡衣-lena-睡衣套裝-石竹粉色-26f-主圖-rmt4y3d.webp
 * 用途是 主圖／商品圖-N／規格選項名稱／描述圖-NN。
 * 識別碼取蝦皮圖片 ID 的末 8 碼，重跑時靠它認出同一張圖。
 *
 * 下載時順便整理（判斷方式見 scripts/image-frame.ts）：
 *   - 外框（米色底 + 四角品牌 logo、或補白邊成正方形）裁掉，只留中間的照片
 *   - 尺寸表不收：「尺寸表」欄位整欄略過，其他位置看起來像白底線稿尺寸表的也略過
 *
 * 可重複執行：已經下載過的圖片直接沿用，不會重抓；商品改名時就地改檔名。
 * 改名後資料庫裡的舊網址就失效了，匯入後一定要接著跑 npm run seed（它會一併換掉訂單明細裡的舊網址）。
 * 蝦皮上已經拿掉的圖不刪檔 —— 舊訂單的明細可能還指著它。
 *
 * 圖片按商品分資料夾、同一張圖在不同商品各存一份 —— 後台刪商品圖時會連檔案一起刪
 * （lib/uploads.ts 的 deleteUploadedFile），共用檔案的話刪一件會讓另一件破圖。
 */

import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { strFromU8, unzipSync } from 'fflate'
import sharp from 'sharp'
import { detectFrame, isSizeChart } from './image-frame'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT_JSON = path.join(ROOT, 'prisma', 'seed-data', 'shopee.json')
const IMAGE_ROOT = path.join(ROOT, 'public', 'uploads', 'shopee')
const IMAGE_URL_PREFIX = '/uploads/shopee'

/** 與後台上傳（lib/uploads.ts）一致：WebP、最長邊 1600、品質 82 */
const MAX_DIMENSION = 1600
const WEBP_QUALITY = 82
const DOWNLOAD_CONCURRENCY = 8
/** 判斷外框／尺寸表用的縮圖大小，夠看出照片邊界即可 */
const ANALYSIS_SIZE = 300
/** 裁掉外框後四邊再內縮的比例 */
const FRAME_INSET = 0.01
/** 蝦皮「尺寸表」欄位的圖一律不收，官網的尺寸寫在描述文字裡 */
const SIZE_CHART_ROLE = '尺寸表'
/** 外框與尺寸表的處理見 scripts/image-frame.ts */
const SKIPPED = 'skipped' as const
const DOWNLOAD_RETRIES = 3

/** 匯出檔前 6 列是欄位代碼、範本 id、中文欄名、必填說明、填寫說明，第 7 列起才是商品 */
const HEADER_ROWS = 6

/**
 * 蝦皮規定價格至少 1 元，賣場用 2 元當「洽詢／暫不販售」的佔位價。
 * 低於這個價格的商品照樣匯入，但設成下架 —— 官網不能真的用 2 元賣出去。
 */
const MIN_SELLABLE_PRICE = 10

// ---------------------------------------------------------------------------
// 輸出型別（prisma/seed.ts 也用這組）
// ---------------------------------------------------------------------------

export type ShopeeImage = { url: string; width: number; height: number }

export type ShopeeVariant = {
  /** 蝦皮的商品選項 ID（model_id） */
  sourceId: string
  name: string
  options: Record<string, string>
  price: number
  stock: number
}

export type ShopeeCategory = { key: string; name: string; nameEn: string }

export type ShopeeProduct = {
  /** 蝦皮的商品 ID（item_id） */
  sourceId: string
  sourceUrl: string
  /** 蝦皮上的原始標題，留著對照用 */
  rawName: string
  name: string
  brandName: string | null
  categoryKey: string
  /** 蝦皮的分類路徑，例如「Women Clothes/Sleepwear & Pajamas/Pajamas」 */
  shopeeCategory: string
  status: 'ACTIVE' | 'ARCHIVED'
  summary: string
  descriptionHtml: string
  images: ShopeeImage[]
  variants: ShopeeVariant[]
}

export type ShopeeExport = {
  importedAt: string
  shopId: string
  sourceFiles: string[]
  categories: ShopeeCategory[]
  products: ShopeeProduct[]
}

// ---------------------------------------------------------------------------
// 讀 xlsx（只取第一張工作表的儲存格文字，不需要整套試算表函式庫）
// ---------------------------------------------------------------------------

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** <si> / <is> 裡可能是單一 <t>，也可能是多段 rich text <r><t>…</t></r> */
function textOf(xml: string): string {
  let out = ''
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += decodeXml(m[1])
  return out
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A'
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

type Row = (string | null)[]

function readFirstSheet(file: string): Row[] {
  const zip = unzipSync(readFileSync(file))
  const shared: string[] = []
  const sst = zip['xl/sharedStrings.xml']
  if (sst) for (const m of strFromU8(sst).matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]))

  const sheetName = Object.keys(zip)
    .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .sort()[0]
  if (!sheetName) throw new Error(`${file} 裡找不到工作表`)

  const rows: Row[] = []
  const sheet = strFromU8(zip[sheetName])
  for (const rowMatch of sheet.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row: Row = []
    const body = rowMatch[1] ?? ''
    for (const c of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]
      const inner = c[2] ?? ''
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1]
      if (!ref) continue
      const type = /\bt="(\w+)"/.exec(attrs)?.[1]
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
      let value: string | null = null
      if (type === 's' && v !== undefined) value = shared[Number(v)] ?? null
      else if (type === 'inlineStr') value = textOf(inner)
      else if (v !== undefined) value = decodeXml(v)
      row[columnIndex(ref)] = value
    }
    rows.push(Array.from(row, (x) => x ?? null))
  }
  return rows
}

function latestExport(dir: string, files: string[], kind: string): string {
  const matched = files.filter((f) => f.startsWith(`mass_update_${kind}_info_`) && f.endsWith('.xlsx')).sort()
  const latest = matched.at(-1)
  if (!latest) throw new Error(`${dir} 裡找不到 mass_update_${kind}_info_*.xlsx`)
  return path.join(dir, latest)
}

// ---------------------------------------------------------------------------
// 整理商品名稱、品牌、分類、狀態
// ---------------------------------------------------------------------------

/**
 * 蝦皮標題塞了很多給蝦皮搜尋用的店名與發票字樣，在自己的官網上是雜訊。
 * 只拔掉店名／發票這類字，【預購】【現貨】這類出貨狀態留著 —— 那是客人需要知道的。
 */
const STORE_NOISE: RegExp[] = [
  // 要加 u 旗標：🔖 在 UTF-16 是兩個碼元，少了 u 的話 ? 只作用在後半個
  /🔖?\s*開立發票/gu,
  /提供發票/g,
  /SAGAN\s*莎岡(?:選品店|選品|精選推薦)?®?/gi,
  /SAGAN\s*(?:選品|韓國代購|韓國)/gi,
  /莎岡選品店?®?/g,
  /\bSAGAN\b/gi,
  /®/g,
]

export function cleanProductName(raw: string): string {
  let s = raw
  for (const re of STORE_NOISE) s = s.replace(re, ' ')
  s = s
    .replace(/\|/g, '｜')
    .replace(/[ \t\u3000]+/g, ' ')
    // 拔掉店名之後會留下「｜ ｜」「【預購｜】」這類空段
    .replace(/(?:\s*｜\s*)+/g, '｜')
    .replace(/【｜+/g, '【')
    .replace(/｜+】/g, '】')
    .replace(/【\s*】/g, '')
    .replace(/^[\s｜]+|[\s｜]+$/g, '')
    .replace(/】｜/g, '】')
    .trim()
  return s || raw.trim()
}

/** 依出現頻率排；比對時不分大小寫，第一個命中的就是品牌 */
const BRANDS: { name: string; pattern: RegExp }[] = [
  { name: 'LUNALUZ', pattern: /lunaluz/i },
  { name: 'ULLALA', pattern: /ullala/i },
  { name: 'BALCONY', pattern: /balcony/i },
  // 舊商品標題裡有「MOMM」的筆誤
  { name: 'MMOM', pattern: /mmom|momm/i },
  { name: 'FOTL', pattern: /fotl/i },
  { name: 'VIVIHOME', pattern: /vivihome/i },
  { name: 'The Warmth', pattern: /the\s*warmth/i },
  { name: 'KOZNOK', pattern: /koznok/i },
  { name: 'Maison de Paris', pattern: /maison\s*de\s*paris/i },
  { name: "JO'S LOUNGE", pattern: /jo['’]s\s*lounge/i },
  { name: 'MUSE MOOD', pattern: /muse\s*mood/i },
  { name: 'GoGreen Object', pattern: /gogreen\s*object/i },
  { name: 'LAZYZ', pattern: /lazyz/i },
]

export function detectBrand(name: string): string | null {
  return BRANDS.find((b) => b.pattern.test(name))?.name ?? null
}

/** 蝦皮的分類太細（40 幾個），併成官網導覽用得上的幾大類 */
export const CATEGORIES: ShopeeCategory[] = [
  { key: 'pajamas', name: '睡衣套裝', nameEn: 'Pajama Sets' },
  { key: 'nightdresses', name: '睡衣洋裝', nameEn: 'Nightdresses' },
  { key: 'robes', name: '睡袍・浴袍', nameEn: 'Robes' },
  { key: 'men', name: '男士睡衣', nameEn: "Men's Sleepwear" },
  { key: 'kids', name: '童裝', nameEn: 'Kids' },
  { key: 'womenswear', name: '女裝服飾', nameEn: 'Womenswear' },
  { key: 'accessories', name: '飾品配件', nameEn: 'Accessories' },
  { key: 'home', name: '居家生活', nameEn: 'Home & Living' },
]

export function categoryKeyOf(shopeePath: string): string {
  if (/Sleepwear & Pajamas\/Night Dresses/.test(shopeePath)) return 'nightdresses'
  if (/Kimonos & Robes|Bath Robes/.test(shopeePath)) return 'robes'
  if (/^Women Clothes\/Sleepwear & Pajamas/.test(shopeePath)) return 'pajamas'
  if (/^Men Clothes/.test(shopeePath)) return 'men'
  if (/^Baby & Kids/.test(shopeePath)) return 'kids'
  if (/^Women Clothes/.test(shopeePath)) return 'womenswear'
  if (/^(Fashion Accessories|Women Bags|Beauty)/.test(shopeePath)) return 'accessories'
  // 室內拖鞋、寢具、餐具、圍裙等都歸居家
  return 'home'
}

/** 標題寫明已經不賣的商品 */
const DISCONTINUED = /⛔|斷貨|售完|完售/

// ---------------------------------------------------------------------------
// 描述：蝦皮是純文字，圖片以獨立一行的網址出現
// ---------------------------------------------------------------------------

const SHOPEE_IMAGE_URL = /^https:\/\/[a-z0-9.-]*shopeesz\.com\/file\/([a-z0-9-]+)$/i

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 「設計語言｜Design Language」這種中英對照的段落標題 */
const SECTION_HEADING = /^[^\s｜]{2,10}｜[A-Za-z][A-Za-z &'()（）/-]{1,40}$/

export type DescBlock =
  | { type: 'p'; lines: string[] }
  | { type: 'h3'; text: string }
  | { type: 'img'; src: string }

export function parseDescription(text: string): DescBlock[] {
  const blocks: DescBlock[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length > 0) blocks.push({ type: 'p', lines: para })
    para = []
  }
  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim()
    if (!line) {
      flush()
      continue
    }
    if (SHOPEE_IMAGE_URL.test(line)) {
      flush()
      blocks.push({ type: 'img', src: line })
      continue
    }
    if (SECTION_HEADING.test(line)) {
      flush()
      blocks.push({ type: 'h3', text: line })
      continue
    }
    para.push(line)
  }
  flush()
  return blocks
}

export function renderDescription(
  blocks: DescBlock[],
  localImages: Map<string, ShopeeImage>,
  alt: string,
): string {
  const html: string[] = []
  for (const b of blocks) {
    if (b.type === 'p') html.push(`<p>${b.lines.map(escapeHtml).join('<br>')}</p>`)
    else if (b.type === 'h3') html.push(`<h3>${escapeHtml(b.text)}</h3>`)
    else {
      const img = localImages.get(b.src)
      // 下載失敗的圖直接略過，不留指向蝦皮 CDN 的外連
      if (img) {
        html.push(
          `<p><img src="${img.url}" alt="${escapeHtml(alt)}" width="${img.width}" height="${img.height}"></p>`,
        )
      }
    }
  }
  return html.join('\n')
}

export function summaryOf(blocks: DescBlock[]): string {
  const first = blocks.find((b): b is Extract<DescBlock, { type: 'p' }> => b.type === 'p')
  if (!first) return ''
  // 以字元（code point）截斷：直接 slice 會把 emoji 切成半個 surrogate，Postgres 收不下
  const chars = Array.from(first.lines.join('').replace(/\s+/g, ' ').trim())
  return chars.length > 150 ? `${chars.slice(0, 149).join('')}…` : chars.join('')
}

// ---------------------------------------------------------------------------
// 圖片檔名
// ---------------------------------------------------------------------------

/** 與 prisma/seed.ts 的 slugify 相同：保留中文，空白與分隔符號換成 -，其他符號拿掉 */
export function slugify(input: string): string {
  return input
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/[\s/\\｜|]+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
}

/** 以字元（code point）截斷，不把 emoji 切成半個 surrogate */
function takeSlug(slug: string, max: number): string {
  return Array.from(slug).slice(0, max).join('').replace(/-+$/, '')
}

/**
 * 檔名用的商品名：拿掉【現貨】【預購…】與 ⛔完售 這類會變動的狀態字，
 * 否則商品從預購轉現貨，所有圖片就得跟著改名。
 */
export function imageBaseName(productName: string): string {
  const core = productName.replace(/【[^】]*】/g, ' ').replace(/⛔\s*(?:完售|售完|斷貨)?/gu, ' ')
  return takeSlug(slugify(core), 40) || 'product'
}

/** 蝦皮圖片 ID 的末 8 碼，重跑匯入時用來認出同一張圖（同一件商品裡不會撞） */
export function imageTag(shopeeImageId: string): string {
  return shopeeImageId.toLowerCase().slice(-8)
}

export function imageFileName(base: string, role: string, shopeeImageId: string): string {
  const label = takeSlug(slugify(role), 24)
  return `${[base, label, imageTag(shopeeImageId)].filter(Boolean).join('-')}.webp`
}

// ---------------------------------------------------------------------------
// 圖片下載
// ---------------------------------------------------------------------------

type ImageJob = {
  url: string
  productId: string
  /** 依內容命名的檔名 */
  file: string
  /** 蝦皮圖片 ID，用來找出舊檔名的同一張圖 */
  shopeeId: string
  /** 主圖、商品圖-N、規格選項名稱、尺寸表、描述圖-NN */
  role: string
  maxDimension: number
}

/** 每個商品資料夾只讀一次目錄，給「找舊檔改名」用 */
const dirListings = new Map<string, Promise<string[]>>()
function listProductDir(productId: string): Promise<string[]> {
  let listing = dirListings.get(productId)
  if (!listing) {
    listing = readdir(path.join(IMAGE_ROOT, productId)).catch(() => [])
    dirListings.set(productId, listing)
  }
  return listing
}

/** 同一張圖之前存過的檔名：最早版本用蝦皮 ID 當檔名，之後是 <…>-<識別碼>.webp */
async function findPrevious(job: ImageJob): Promise<string | null> {
  const files = await listProductDir(job.productId)
  const legacy = `${job.shopeeId}.webp`
  const suffix = `-${imageTag(job.shopeeId)}.webp`
  return files.find((f) => f === legacy || (f !== job.file && f.endsWith(suffix))) ?? null
}

async function downloadOne(job: ImageJob): Promise<ShopeeImage | typeof SKIPPED> {
  if (job.role === SIZE_CHART_ROLE) return SKIPPED
  const dir = path.join(IMAGE_ROOT, job.productId)
  const dest = path.join(dir, job.file)
  // 存未編碼的原始檔名：後台刪圖（deleteUploadedFile）直接拿網址對應磁碟路徑，編碼過就找不到檔案
  const publicUrl = `${IMAGE_URL_PREFIX}/${job.productId}/${job.file}`

  if (!existsSync(dest)) {
    const previous = await findPrevious(job)
    if (previous) await rename(path.join(dir, previous), dest)
  }
  if (existsSync(dest)) {
    const meta = await sharp(dest).metadata()
    return { url: publicUrl, width: meta.width ?? 0, height: meta.height ?? 0 }
  }

  let lastError: unknown
  for (let attempt = 1; attempt <= DOWNLOAD_RETRIES; attempt++) {
    try {
      const res = await fetch(job.url, { signal: AbortSignal.timeout(60_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // 先轉正並解成原始像素，裁切、縮圖都從這份做，只在最後存 WebP 時壓縮一次
      const decoded = await sharp(Buffer.from(await res.arrayBuffer()))
        .rotate()
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
      const raw = { raw: { width: decoded.info.width, height: decoded.info.height, channels: decoded.info.channels } }
      const meta = decoded.info
      const { data, info } = await sharp(decoded.data, raw)
        .resize(ANALYSIS_SIZE, ANALYSIS_SIZE, { fit: 'inside' })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
      const preview = { data, width: info.width, height: info.height }
      if (isSizeChart(preview)) return SKIPPED

      let pipeline = sharp(decoded.data, raw)
      const frame = detectFrame(preview)
      if (frame) {
        // 換回原圖座標，四邊再內縮一點：分析圖的誤差，以及有些框在照片外緣還描了一圈細線
        const k = meta.width / info.width
        const insetX = Math.round(frame.width * k * FRAME_INSET)
        const insetY = Math.round(frame.height * k * FRAME_INSET)
        const fullW = meta.width
        const fullH = meta.height
        const left = Math.min(Math.round(frame.left * k) + insetX, fullW - 1)
        const top = Math.min(Math.round(frame.top * k) + insetY, fullH - 1)
        pipeline = pipeline.extract({
          left,
          top,
          width: Math.min(Math.round(frame.width * k) - insetX * 2, fullW - left),
          height: Math.min(Math.round(frame.height * k) - insetY * 2, fullH - top),
        })
      }
      const output = await pipeline
        .resize({ width: job.maxDimension, height: job.maxDimension, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer({ resolveWithObject: true })
      await mkdir(path.dirname(dest), { recursive: true })
      await writeFile(dest, output.data)
      return { url: publicUrl, width: output.info.width, height: output.info.height }
    } catch (error) {
      lastError = error
      // 404 重試也不會好
      if (error instanceof Error && error.message === 'HTTP 404') break
      await new Promise((r) => setTimeout(r, 1000 * attempt))
    }
  }
  throw lastError
}

/** 回傳 商品 ID → (蝦皮網址 → 本機圖片) */
async function downloadAll(jobs: ImageJob[]): Promise<Map<string, Map<string, ShopeeImage>>> {
  const results = new Map<string, Map<string, ShopeeImage>>()
  const failures: string[] = []
  let skipped = 0
  let next = 0
  let done = 0
  const startedAt = Date.now()

  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++]
      try {
        const img = await downloadOne(job)
        if (img === SKIPPED) {
          skipped++
          done++
          continue
        }
        let perProduct = results.get(job.productId)
        if (!perProduct) results.set(job.productId, (perProduct = new Map()))
        perProduct.set(job.url, img)
      } catch (error) {
        failures.push(`${job.productId} ${job.url}：${error instanceof Error ? error.message : String(error)}`)
      }
      done++
      if (done % 250 === 0 || done === jobs.length) {
        const secs = Math.round((Date.now() - startedAt) / 1000)
        console.log(`  圖片 ${done}/${jobs.length}（${secs} 秒）`)
      }
    }
  }
  await Promise.all(Array.from({ length: DOWNLOAD_CONCURRENCY }, worker))
  if (skipped > 0) console.log(`  略過尺寸表 ${skipped} 張`)

  if (failures.length > 0) {
    console.warn(`\n  ⚠️ ${failures.length} 張圖片下載失敗，已略過：`)
    for (const f of failures.slice(0, 20)) console.warn(`    ${f}`)
    if (failures.length > 20) console.warn(`    …另外 ${failures.length - 20} 張`)
  }
  return results
}

// ---------------------------------------------------------------------------

type Draft = {
  id: string
  rawName: string
  description: string
  shopeeCategory: string
  /** 依顯示順序：主圖、商品圖 1–8、規格圖、尺寸表 */
  imageUrls: string[]
  /** 圖片網址 → 用途（主圖、商品圖-1、規格選項名稱、尺寸表），檔名用 */
  imageRoles: Map<string, string>
  variationLabel: string | null
  variants: { id: string; name: string | null; price: number; stock: number }[]
}

function cell(row: Row, i: number): string {
  return (row[i] ?? '').trim()
}

function shopeeImageIdOf(url: string): string {
  const id = SHOPEE_IMAGE_URL.exec(url)?.[1]
  if (!id) throw new Error(`不是蝦皮圖片網址：${url}`)
  return id
}


async function main() {
  const dir = process.argv[2]
  if (!dir) {
    console.error('用法：npm run import:shopee -- "<放三份 mass_update_*.xlsx 的資料夾>"')
    process.exit(1)
  }
  const files = await readdir(dir)
  const basicFile = latestExport(dir, files, 'basic')
  const salesFile = latestExport(dir, files, 'sales')
  const mediaFile = latestExport(dir, files, 'media')
  const shopId = /_info_(\d+)_/.exec(path.basename(basicFile))?.[1] ?? ''

  console.log('\n=== 讀取蝦皮匯出檔 ===\n')
  const basic = readFirstSheet(basicFile).slice(HEADER_ROWS)
  const sales = readFirstSheet(salesFile).slice(HEADER_ROWS)
  const media = readFirstSheet(mediaFile).slice(HEADER_ROWS)

  const drafts = new Map<string, Draft>()
  for (const r of basic) {
    const id = cell(r, 0)
    if (!/^\d+$/.test(id)) continue
    drafts.set(id, {
      id,
      rawName: cell(r, 2),
      description: r[3] ?? '',
      shopeeCategory: '',
      imageUrls: [],
      imageRoles: new Map(),
      variationLabel: null,
      variants: [],
    })
  }

  for (const r of media) {
    const d = drafts.get(cell(r, 0))
    if (!d) continue
    d.shopeeCategory = cell(r, 3).replace(/^\d+\s*-\s*/, '')
    // 4：主圖，5–12：商品圖 1–8，17,19,…,33：規格選項圖（名稱在前一欄），14：尺寸表圖
    const slots: [col: number, role: string][] = [
      [4, '主圖'],
      ...[5, 6, 7, 8, 9, 10, 11, 12].map((c, i): [number, string] => [c, `商品圖-${i + 1}`]),
      ...[17, 19, 21, 23, 25, 27, 29, 31, 33].map((c, i): [number, string] => [
        c,
        cell(r, c - 1) || `規格-${i + 1}`,
      ]),
      [14, '尺寸表'],
    ]
    for (const [col, role] of slots) {
      const url = cell(r, col)
      if (!SHOPEE_IMAGE_URL.test(url) || d.imageRoles.has(url)) continue
      d.imageRoles.set(url, role)
      d.imageUrls.push(url)
    }
    d.variationLabel = cell(r, 15) || null
  }

  for (const r of sales) {
    const d = drafts.get(cell(r, 0))
    if (!d) continue
    d.variants.push({
      id: cell(r, 2),
      name: cell(r, 3).replace(/\s+/g, ' ') || null,
      price: Number.parseInt(cell(r, 6), 10) || 0,
      stock: Math.max(0, Number.parseInt(cell(r, 8), 10) || 0),
    })
  }

  const list = [...drafts.values()].filter((d) => d.variants.length > 0)
  console.log(`  商品 ${list.length} 件、規格 ${list.reduce((n, d) => n + d.variants.length, 0)} 個`)

  // 收集要下載的圖片
  const descBlocks = new Map<string, DescBlock[]>()
  const jobs: ImageJob[] = []
  for (const d of list) {
    const blocks = parseDescription(d.description)
    descBlocks.set(d.id, blocks)
    const base = imageBaseName(cleanProductName(d.rawName))
    const seen = new Set<string>()
    const add = (url: string, role: string) => {
      if (seen.has(url)) return
      seen.add(url)
      const shopeeId = shopeeImageIdOf(url)
      jobs.push({
        url,
        productId: d.id,
        file: imageFileName(base, role, shopeeId),
        shopeeId,
        role,
        maxDimension: MAX_DIMENSION,
      })
    }
    for (const url of d.imageUrls) add(url, d.imageRoles.get(url) ?? '')
    let n = 0
    for (const b of blocks) {
      if (b.type === 'img') add(b.src, `描述圖-${String(++n).padStart(2, '0')}`)
    }
  }

  console.log(`\n=== 下載圖片（${jobs.length} 張，已存在的會跳過）===\n`)
  const images = await downloadAll(jobs)

  const products: ShopeeProduct[] = list.map((d) => {
    const name = cleanProductName(d.rawName)
    const local = images.get(d.id) ?? new Map<string, ShopeeImage>()
    const blocks = descBlocks.get(d.id) ?? []
    const minPrice = Math.min(...d.variants.map((v) => v.price))
    const totalStock = d.variants.reduce((n, v) => n + v.stock, 0)
    const discontinued = DISCONTINUED.test(d.rawName) && totalStock === 0

    return {
      sourceId: d.id,
      sourceUrl: `https://shopee.tw/product/${shopId}/${d.id}`,
      rawName: d.rawName,
      name,
      brandName: detectBrand(d.rawName),
      categoryKey: categoryKeyOf(d.shopeeCategory),
      shopeeCategory: d.shopeeCategory,
      status: discontinued || minPrice < MIN_SELLABLE_PRICE ? 'ARCHIVED' : 'ACTIVE',
      summary: summaryOf(blocks),
      descriptionHtml: renderDescription(blocks, local, name),
      images: d.imageUrls.map((u) => local.get(u)).filter((i): i is ShopeeImage => Boolean(i)),
      variants: d.variants.map((v) => ({
        sourceId: v.id,
        name: v.name ?? '單一規格',
        options: d.variationLabel && v.name ? { [d.variationLabel]: v.name } : {},
        price: v.price,
        stock: v.stock,
      })),
    }
  })

  const out: ShopeeExport = {
    importedAt: new Date().toISOString(),
    shopId,
    sourceFiles: [basicFile, salesFile, mediaFile].map((f) => path.basename(f)),
    categories: CATEGORIES,
    products,
  }
  await mkdir(path.dirname(OUT_JSON), { recursive: true })
  await writeFile(OUT_JSON, JSON.stringify(out, null, 2))

  const active = products.filter((p) => p.status === 'ACTIVE').length
  console.log(`\n已寫入 ${path.relative(ROOT, OUT_JSON)}`)
  console.log(`  上架 ${active} 件、下架（已斷貨／佔位價）${products.length - active} 件`)
  console.log('\n接著執行：npm run seed\n')
}

// 被測試或 seed.ts import 時不執行
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('匯入失敗：', err)
    process.exit(1)
  })
}
