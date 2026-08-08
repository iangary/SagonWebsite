/**
 * 把 scripts/scrape-sagan.ts 產出的 JSON 灌進資料庫，並建立開發用的帳號與優惠券。
 *
 * 用法：npm run seed
 * 可重複執行 —— 全部以 sourceId / slug / code upsert，不會產生重複資料。
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { PrismaClient, type Prisma } from '@prisma/client'
import { hash } from '@node-rs/argon2'

const db = new PrismaClient()

const ROOT = path.resolve(import.meta.dirname, '..')
const DATA_FILE = path.join(ROOT, 'prisma', 'seed-data', 'sagan.json')

/**
 * 來源站的售完商品庫存是 0，全部照抄會導致本機沒有任何商品可以下單測試。
 * 有貨的商品一律補到這個數量，方便跑結帳與庫存預扣流程。
 */
const DEV_MIN_STOCK = 20

type ScrapedVariant = { sourceId: string; name: string; stock: number; soldOut: boolean }
type ScrapedProduct = {
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
type ScrapedCategory = { sourceId: string; name: string; productSourceIds: string[] }
type ScrapeResult = {
  scrapedAt: string
  source: string
  categories: ScrapedCategory[]
  products: ScrapedProduct[]
}

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s/\\｜|]+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
}

const BRAND_META: Record<string, { slug: string; description: string; sortOrder: number }> = {
  MMOM: { slug: 'mmom', description: '韓國 MMOM，柔軟親膚的日常睡衣。', sortOrder: 1 },
  LUNALUZ: { slug: 'lunaluz', description: '韓國 LUNALUZ，優雅細緻的睡衣選品。', sortOrder: 2 },
  ULLALA: { slug: 'ullala', description: '韓國 ULLALA，經典舒適的睡衣套裝。', sortOrder: 3 },
  BALCONY: { slug: 'balcony', description: '韓國 BALCONY，質感純棉與蕾絲工藝。', sortOrder: 4 },
  VIVIHOME: { slug: 'vivihome', description: '韓國 VIVIHOME，居家生活的溫柔提案。', sortOrder: 5 },
  'The Warmth': { slug: 'the-warmth', description: '韓國 The Warmth 手作圍裙。', sortOrder: 6 },
  FOTL: { slug: 'fotl', description: 'FOTL 香氛與手工飾品。', sortOrder: 7 },
  棉紗之間: { slug: 'mianshazhijian', description: '莎岡推薦｜棉紗之間。', sortOrder: 8 },
}

async function loadScrapeResult(): Promise<ScrapeResult | null> {
  if (!existsSync(DATA_FILE)) return null
  return JSON.parse(await readFile(DATA_FILE, 'utf8')) as ScrapeResult
}

// ---------------------------------------------------------------------------

async function seedBrands(products: ScrapedProduct[]) {
  const names = new Set(products.map((p) => p.brandName).filter((n): n is string => Boolean(n)))
  const idBySlug = new Map<string, string>()

  for (const name of names) {
    const meta = BRAND_META[name] ?? { slug: slugify(name), description: '', sortOrder: 99 }
    const brand = await db.brand.upsert({
      where: { slug: meta.slug },
      update: { name, description: meta.description, sortOrder: meta.sortOrder },
      create: { slug: meta.slug, name, description: meta.description, sortOrder: meta.sortOrder },
    })
    idBySlug.set(name, brand.id)
  }

  console.log(`  品牌 ${idBySlug.size} 個`)
  return idBySlug
}

async function seedCategories(categories: ScrapedCategory[]) {
  const idBySourceId = new Map<string, string>()

  for (const [index, cat] of categories.entries()) {
    const slug = slugify(cat.name) || `category-${cat.sourceId}`
    const record = await db.category.upsert({
      where: { sourceId: cat.sourceId },
      update: { name: cat.name, sortOrder: index },
      create: { sourceId: cat.sourceId, slug, name: cat.name, sortOrder: index },
    })
    idBySourceId.set(cat.sourceId, record.id)
  }

  console.log(`  分類 ${idBySourceId.size} 個`)
  return idBySourceId
}

function buildVariants(product: ScrapedProduct): Prisma.ProductVariantCreateWithoutProductInput[] {
  // 沒有規格選項的商品（單一款式）也要有一個變體，購物車才有東西可以指向
  if (product.variants.length === 0) {
    return [
      {
        sku: `SG-${product.sourceId}-0`,
        name: '單一規格',
        options: {},
        price: product.price,
        compareAtPrice: product.compareAtPrice,
        stock: DEV_MIN_STOCK,
        sortOrder: 0,
      },
    ]
  }

  return product.variants.map((v, i) => ({
    sku: `SG-${product.sourceId}-${v.sourceId}`,
    name: v.name || '單一規格',
    options: v.name ? { 規格: v.name } : {},
    price: product.price,
    compareAtPrice: product.compareAtPrice,
    stock: v.soldOut ? 0 : Math.max(v.stock, DEV_MIN_STOCK),
    isActive: true,
    sortOrder: i,
  }))
}

async function seedProducts(
  products: ScrapedProduct[],
  brandIds: Map<string, string>,
  categoryIds: Map<string, string>,
) {
  let created = 0

  for (const product of products) {
    const slug = `${slugify(product.name) || 'product'}-${product.sourceId}`
    const brandId = product.brandName ? (brandIds.get(product.brandName) ?? null) : null

    const base = {
      slug,
      name: product.name,
      summary: product.summary || null,
      descriptionHtml: product.descriptionHtml || null,
      brandId,
      basePrice: product.price,
      compareAtPrice: product.compareAtPrice,
      sourceUrl: product.sourceUrl,
      status: 'ACTIVE' as const,
      publishedAt: new Date(),
      seoTitle: product.name,
      seoDescription: product.summary.slice(0, 155) || null,
    }

    // 重跑時整組換掉圖片與變體，避免殘留舊資料
    const existing = await db.product.findUnique({
      where: { sourceId: product.sourceId },
      select: { id: true },
    })

    const record = existing
      ? await db.product.update({ where: { id: existing.id }, data: base })
      : await db.product.create({ data: { ...base, sourceId: product.sourceId } })

    if (existing) {
      await db.productImage.deleteMany({ where: { productId: record.id } })
      await db.productCategory.deleteMany({ where: { productId: record.id } })
    }

    if (product.images.length > 0) {
      await db.productImage.createMany({
        data: product.images.map((url, i) => ({
          productId: record.id,
          url,
          alt: product.name,
          sortOrder: i,
        })),
      })
    }

    for (const variant of buildVariants(product)) {
      await db.productVariant.upsert({
        where: { sku: variant.sku },
        update: {
          name: variant.name,
          options: variant.options as Prisma.InputJsonValue,
          price: variant.price,
          compareAtPrice: variant.compareAtPrice,
          stock: variant.stock,
          sortOrder: variant.sortOrder,
        },
        create: { ...variant, productId: record.id },
      })
    }

    const links = product.categorySourceIds
      .map((sid) => categoryIds.get(sid))
      .filter((id): id is string => Boolean(id))
    if (links.length > 0) {
      await db.productCategory.createMany({
        data: links.map((categoryId) => ({ productId: record.id, categoryId })),
        skipDuplicates: true,
      })
    }

    created++
  }

  console.log(`  商品 ${created} 件`)
}

// ---------------------------------------------------------------------------

async function seedAccounts() {
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@sagon.local').toLowerCase()
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'admin1234'
  const passwordHash = await hash(adminPassword, { memoryCost: 19_456, timeCost: 2, parallelism: 1 })

  await db.user.upsert({
    where: { email: adminEmail },
    update: { role: 'ADMIN', passwordHash },
    create: {
      email: adminEmail,
      name: '系統管理員',
      role: 'ADMIN',
      passwordHash,
      emailVerified: new Date(),
    },
  })

  await db.user.upsert({
    where: { email: 'customer@sagon.local' },
    update: {},
    create: {
      email: 'customer@sagon.local',
      name: '測試會員',
      passwordHash,
      phone: '0912345678',
      phoneVerified: new Date(),
      emailVerified: new Date(),
      addresses: {
        create: {
          recipient: '測試會員',
          phone: '0912345678',
          zip: '104',
          city: '台北市',
          district: '中山區',
          line1: '中山北路二段 45 號 3 樓',
          isDefault: true,
        },
      },
    },
  })

  console.log(`  帳號：${adminEmail}（ADMIN）／customer@sagon.local，密碼皆為 ${adminPassword}`)
}

async function seedCoupons() {
  const coupons: Prisma.CouponCreateInput[] = [
    {
      code: 'WELCOME100',
      description: '新會員首購折 100 元',
      type: 'FIXED',
      value: 100,
      minSubtotal: 1000,
      perUserLimit: 1,
    },
    {
      code: 'SPRING10',
      description: '春季全站 9 折',
      type: 'PERCENT',
      value: 10,
      minSubtotal: 0,
      perUserLimit: 3,
    },
    {
      code: 'FREESHIP',
      description: '免運費',
      type: 'FREE_SHIPPING',
      value: 0,
      minSubtotal: 500,
      perUserLimit: 5,
    },
  ]

  for (const coupon of coupons) {
    await db.coupon.upsert({
      where: { code: coupon.code },
      update: { description: coupon.description, type: coupon.type, value: coupon.value },
      create: coupon,
    })
  }

  console.log(`  優惠券 ${coupons.length} 張：${coupons.map((c) => c.code).join('、')}`)
}

async function seedBanners() {
  // Hero 圖沿用第一件商品的主圖，這樣不需要另外準備素材
  const first = await db.productImage.findFirst({
    orderBy: { product: { createdAt: 'asc' } },
    select: { url: true },
  })
  if (!first) return

  await db.banner.upsert({
    where: { id: 'seed-hero' },
    update: { imageUrl: first.url },
    create: {
      id: 'seed-hero',
      title: '讓自己幸福，是他唯一的道德觀',
      subtitle: '嚴選韓國睡衣、寢具與家居飾品',
      imageUrl: first.url,
      linkUrl: '/product/all',
      placement: 'hero',
      sortOrder: 0,
    },
  })
  console.log('  首頁 Hero 1 張')
}

// ---------------------------------------------------------------------------

async function main() {
  console.log('\n=== 開始 seed ===\n')

  const data = await loadScrapeResult()

  if (!data) {
    console.log('找不到 prisma/seed-data/sagan.json，只建立帳號與優惠券。')
    console.log('要灌入商品資料請先執行： SEED_SOURCE=sagan npm run scrape\n')
    await seedAccounts()
    await seedCoupons()
    console.log('\n=== 完成 ===\n')
    return
  }

  console.log(`資料來源：${data.source}（抓取於 ${data.scrapedAt}）\n`)

  const brandIds = await seedBrands(data.products)
  const categoryIds = await seedCategories(data.categories)
  await seedProducts(data.products, brandIds, categoryIds)
  await seedAccounts()
  await seedCoupons()
  await seedBanners()

  console.log('\n=== 完成 ===\n')
}

main()
  .catch((err) => {
    console.error('seed 失敗：', err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
