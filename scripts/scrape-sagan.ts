/**
 * 從 sagan.com.tw 抓商品資料，產出 prisma/seed-data/sagan.json 與本機圖片。
 *
 * ⚠️ 這些商品文案與圖片是他人著作權，只能用於本機開發與測試，不可對外上線。
 *    因此本腳本需要 SEED_SOURCE=sagan 才會執行，產出物也都在 .gitignore 內。
 *
 * 用法：SEED_SOURCE=sagan npm run scrape
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { load } from 'cheerio'

const ORIGIN = 'https://www.sagan.com.tw'
const UA = 'Mozilla/5.0 (compatible; SagonDevSeedBot/1.0; local development only)'
/** 對來源站客氣一點：每秒最多一個請求 */
const REQUEST_INTERVAL_MS = 1000
const MAX_IMAGES_PER_PRODUCT = 8

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT_JSON = path.join(ROOT, 'prisma', 'seed-data', 'sagan.json')
const IMAGE_ROOT = path.join(ROOT, 'public', 'uploads', 'seed')

// ---------------------------------------------------------------------------
// 型別
// ---------------------------------------------------------------------------

export type ScrapedVariant = {
  sourceId: string
  name: string
  stock: number
  soldOut: boolean
}

export type ScrapedProduct = {
  sourceId: string
  sourceUrl: string
  name: string
  brandName: string | null
  price: number
  compareAtPrice: number | null
  descriptionHtml: string
  summary: string
  images: string[]
  variants: ScrapedVariant[]
  categorySourceIds: string[]
}

export type ScrapedCategory = {
  sourceId: string
  name: string
  productSourceIds: string[]
}

export type ScrapeResult = {
  scrapedAt: string
  source: string
  categories: ScrapedCategory[]
  products: ScrapedProduct[]
}

// ---------------------------------------------------------------------------
// HTTP（節流 + 重試）
// ---------------------------------------------------------------------------

let lastRequestAt = 0

async function throttle() {
  const wait = lastRequestAt + REQUEST_INTERVAL_MS - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastRequestAt = Date.now()
}

async function fetchText(url: string, attempt = 1): Promise<string> {
  await throttle()
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW,zh;q=0.9' },
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } catch (err) {
    if (attempt >= 3) throw new Error(`抓取失敗 ${url}：${(err as Error).message}`)
    await new Promise((r) => setTimeout(r, 2000 * attempt))
    return fetchText(url, attempt + 1)
  }
}

async function fetchBinary(url: string, attempt = 1): Promise<Buffer | null> {
  await throttle()
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  } catch (err) {
    if (attempt >= 2) {
      console.warn(`  ! 圖片下載失敗，略過：${url}（${(err as Error).message}）`)
      return null
    }
    await new Promise((r) => setTimeout(r, 1500))
    return fetchBinary(url, attempt + 1)
  }
}

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

/** "$1,900" / "1,900" → 1900 */
export function parsePrice(raw: string): number {
  const digits = raw.replace(/[^\d]/g, '')
  return digits ? Number.parseInt(digits, 10) : 0
}

/**
 * data-product-stock 的格式是 "{有無庫存}_{數量}"，例如 "1_2"、"0_0"。
 * 抓不到就當作 0，由 seed 時另外給預設值。
 */
export function parseStock(raw: string | undefined): number {
  if (!raw) return 0
  const parts = raw.split('_')
  const qty = Number.parseInt(parts[1] ?? '', 10)
  return Number.isFinite(qty) && qty >= 0 ? qty : 0
}

/** 商品名稱前綴就是品牌，例如「ULLALA 南方寓所睡衣套裝｜藍色條紋」→ ULLALA */
const KNOWN_BRANDS = [
  'MMOM',
  'LUNALUZ',
  'ULLALA',
  'BALCONY',
  'VIVIHOME',
  'The Warmth',
  'FOTL',
  '棉紗之間',
]

export function inferBrand(productName: string): string | null {
  const upper = productName.toUpperCase()
  for (const brand of KNOWN_BRANDS) {
    if (upper.startsWith(brand.toUpperCase())) return brand
  }
  return null
}

function extractIdsFromHtml(html: string, pattern: RegExp): string[] {
  const found = new Set<string>()
  for (const m of html.matchAll(pattern)) found.add(m[1]!)
  return [...found]
}

async function parseSitemap(): Promise<{ productIds: string[]; categoryIds: string[] }> {
  console.log('· 讀取 sitemap.xml')
  const xml = await fetchText(`${ORIGIN}/sitemap.xml`)
  return {
    productIds: extractIdsFromHtml(xml, /\/product\/detail\/(\d+)/g),
    categoryIds: extractIdsFromHtml(xml, /\/category\/(\d+)/g),
  }
}

/**
 * sitemap 不一定收錄了全部商品，再翻一次 /product/all 的分頁補齊。
 * 連續兩頁沒有新商品就停。
 */
async function crawlAllProductsPages(known: Set<string>): Promise<string[]> {
  const extra: string[] = []
  let emptyStreak = 0

  for (let page = 1; page <= 20 && emptyStreak < 2; page++) {
    const html = await fetchText(`${ORIGIN}/product/all?page=${page}`)
    const ids = extractIdsFromHtml(html, /\/product\/detail\/(\d+)/g)
    if (ids.length === 0) break

    const fresh = ids.filter((id) => !known.has(id))
    if (fresh.length === 0) {
      emptyStreak++
    } else {
      emptyStreak = 0
      for (const id of fresh) {
        known.add(id)
        extra.push(id)
      }
    }
    console.log(`  /product/all?page=${page} → ${ids.length} 筆（新增 ${fresh.length}）`)
  }
  return extra
}

async function parseCategory(categoryId: string): Promise<ScrapedCategory> {
  const html = await fetchText(`${ORIGIN}/category/${categoryId}`)
  const $ = load(html)
  // 分類頁的 h1 是分類名（og:title 反而是第一個商品的名字）
  const name = $('h1').first().text().trim() || `分類 ${categoryId}`
  const productSourceIds = extractIdsFromHtml(html, /\/product\/detail\/(\d+)/g)
  console.log(`  分類 ${categoryId}「${name}」→ ${productSourceIds.length} 件商品`)
  return { sourceId: categoryId, name, productSourceIds }
}

async function parseProduct(productId: string): Promise<ScrapedProduct | null> {
  const url = `${ORIGIN}/product/detail/${productId}`
  const html = await fetchText(url)
  const $ = load(html)

  const name = $('h1').first().text().trim() || $('.js_product_name').first().text().trim()
  if (!name) {
    console.warn(`  ! ${productId} 找不到商品名稱，略過`)
    return null
  }

  const price = parsePrice($('.js_onsale_price .txt_price').first().text())
  const listPrice = parsePrice($('.js_price_span').first().text())
  if (price === 0) {
    console.warn(`  ! ${productId}「${name}」解析不到價格，略過`)
    return null
  }

  // 原價欄位在沒有特價時會等於售價，這種情況不要顯示刪除線價格
  const compareAtPrice = listPrice > price ? listPrice : null

  const images: string[] = []
  $('.product_photos img').each((_, el) => {
    const src = $(el).attr('src') ?? $(el).attr('data-src')
    if (src && !images.includes(src)) images.push(src)
  })

  const variants: ScrapedVariant[] = []
  $('#js_desktop_product_standard option').each((_, el) => {
    const opt = $(el)
    const value = opt.attr('value')
    // value="0" 是「請選擇」的佔位選項
    if (!value || value === '0') return
    const soldOut = opt.attr('data-stock') === 'sold_out'
    variants.push({
      sourceId: value,
      name: (opt.attr('data-name') ?? '').trim(),
      stock: parseStock(opt.attr('data-product-stock')),
      soldOut,
    })
  })

  const descriptionHtml = ($('.product_feature').first().html() ?? '').trim()
  const summary = $('.product_feature').first().text().replace(/\s+/g, ' ').trim().slice(0, 200)

  return {
    sourceId: productId,
    sourceUrl: url,
    name,
    brandName: inferBrand(name),
    price,
    compareAtPrice,
    descriptionHtml,
    summary,
    images: images.slice(0, MAX_IMAGES_PER_PRODUCT),
    variants,
    categorySourceIds: [],
  }
}

// ---------------------------------------------------------------------------
// 圖片下載
// ---------------------------------------------------------------------------

async function downloadImages(product: ScrapedProduct): Promise<string[]> {
  const dir = path.join(IMAGE_ROOT, product.sourceId)
  await mkdir(dir, { recursive: true })

  const localPaths: string[] = []
  for (const [index, remoteUrl] of product.images.entries()) {
    const ext = (path.extname(new URL(remoteUrl).pathname) || '.jpg').split('?')[0]!
    const filename = `${index}${ext}`
    const filePath = path.join(dir, filename)
    const publicPath = `/uploads/seed/${product.sourceId}/${filename}`

    // 重跑時不要重抓已經有的圖
    if (existsSync(filePath)) {
      localPaths.push(publicPath)
      continue
    }

    const buf = await fetchBinary(remoteUrl)
    if (!buf) continue
    await writeFile(filePath, buf)
    localPaths.push(publicPath)
  }
  return localPaths
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

async function main() {
  if (process.env.SEED_SOURCE !== 'sagan') {
    console.error(
      '\n這支腳本會下載 sagan.com.tw 的商品文案與圖片，屬於他人著作權素材，只能用於本機開發。\n' +
        '確認用途後請設定環境變數再執行：\n\n  SEED_SOURCE=sagan npm run scrape\n',
    )
    process.exit(1)
  }

  console.log('\n=== 開始抓取 sagan.com.tw ===\n')

  await mkdir(path.dirname(OUT_JSON), { recursive: true })
  await mkdir(IMAGE_ROOT, { recursive: true })

  // robots.txt 有明文禁止 /order /member /search 等路徑，我們只碰 /product 與 /category，
  // 這裡再核對一次，來源站日後改規則時會直接中止。
  const robots = await fetchText(`${ORIGIN}/robots.txt`)
  const disallowed = robots
    .split(/\r?\n/)
    .filter((l) => l.toLowerCase().startsWith('disallow:'))
    .map((l) => l.slice(9).trim())
  const blocked = disallowed.find((rule) => {
    const prefix = rule.replace(/\*$/, '')
    return prefix && ('/product/'.startsWith(prefix) || '/category/'.startsWith(prefix))
  })
  if (blocked) {
    console.error(`robots.txt 禁止抓取（規則：${blocked}），中止。`)
    process.exit(1)
  }

  const { productIds, categoryIds } = await parseSitemap()
  console.log(`  sitemap → ${productIds.length} 件商品、${categoryIds.length} 個分類\n`)

  const known = new Set(productIds)
  console.log('· 翻 /product/all 分頁補齊')
  const extraIds = await crawlAllProductsPages(known)
  const allProductIds = [...productIds, ...extraIds]
  console.log(`  合計 ${allProductIds.length} 件商品\n`)

  console.log('· 抓分類')
  const categories: ScrapedCategory[] = []
  for (const id of categoryIds) {
    categories.push(await parseCategory(id))
  }
  console.log()

  // 反查：商品 → 屬於哪些分類
  const productToCategories = new Map<string, string[]>()
  for (const category of categories) {
    for (const pid of category.productSourceIds) {
      const list = productToCategories.get(pid) ?? []
      list.push(category.sourceId)
      productToCategories.set(pid, list)
    }
  }

  console.log('· 抓商品明細與圖片')
  const products: ScrapedProduct[] = []
  for (const [i, id] of allProductIds.entries()) {
    const product = await parseProduct(id)
    if (!product) continue

    product.categorySourceIds = productToCategories.get(id) ?? []
    const localImages = await downloadImages(product)
    product.images = localImages

    products.push(product)
    console.log(
      `  [${i + 1}/${allProductIds.length}] ${product.name} — ` +
        `NT$${product.price}／${product.variants.length} 規格／${localImages.length} 圖`,
    )
  }

  const result: ScrapeResult = {
    scrapedAt: new Date().toISOString(),
    source: ORIGIN,
    categories,
    products,
  }

  await writeFile(OUT_JSON, JSON.stringify(result, null, 2), 'utf8')

  console.log(`\n=== 完成 ===`)
  console.log(`  商品 ${products.length} 件、分類 ${categories.length} 個`)
  console.log(`  JSON → ${path.relative(ROOT, OUT_JSON)}`)
  console.log(`  圖片 → ${path.relative(ROOT, IMAGE_ROOT)}`)
  console.log(`\n接著執行： npm run seed\n`)
}

/** 讓 seed 也能讀同一份輸出 */
export async function readScrapeResult(): Promise<ScrapeResult | null> {
  if (!existsSync(OUT_JSON)) return null
  return JSON.parse(await readFile(OUT_JSON, 'utf8')) as ScrapeResult
}

// 只有直接執行時才跑主流程（被 seed import 時不執行）
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((err) => {
    console.error('\n抓取失敗：', err)
    process.exit(1)
  })
}
