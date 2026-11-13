/**
 * 把 scripts/import-shopee.ts 產出的蝦皮商品資料灌進資料庫，並建立開發用的帳號與優惠券。
 *
 * 用法：
 *   npm run import:shopee -- "<蝦皮批次更新匯出檔的資料夾>"
 *   npm run seed                     開發用：商品 + 管理員／測試會員 + demo 優惠券
 *   npm run seed -- --catalog-only   正式站用：只更新品牌、分類、商品與首頁 banner
 *
 * 正式站一律加 --catalog-only。完整模式會把管理員密碼重設成 SEED_ADMIN_PASSWORD、
 * 重建已刪掉的測試會員（密碼同管理員），並且建出客人猜得到的 demo 優惠券。
 *
 * 可重複執行 —— 全部以 sourceId / sku / slug / code upsert，不會產生重複資料。
 * 重跑時以蝦皮匯出檔為準：名稱、描述、價格、庫存都會被蓋回匯出檔的值，
 * 但 slug 建立後就不再改（對外連結與 SEO），後台自己上傳的商品圖也不會動。
 * 匯出檔裡沒有的蝦皮商品會被刪除（有顧客評論的改成下架），所以換一份只含部分商品的匯出檔
 * 就等於把官網的商品縮成那幾件。
 */

import { existsSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { PrismaClient, type Prisma } from '@prisma/client'
import { hash } from '@node-rs/argon2'
import type { ShopeeCategory, ShopeeExport, ShopeeImage, ShopeeProduct } from '../scripts/import-shopee'

const db = new PrismaClient()

const ROOT = path.resolve(import.meta.dirname, '..')
const DATA_FILE = path.join(ROOT, 'prisma', 'seed-data', 'shopee.json')
const LEGACY_IMAGE_DIR = path.join(ROOT, 'public', 'uploads', 'seed')

/** 資料庫裡的 sourceId 前綴，用來和舊的 sagan.com.tw 爬蟲資料（純數字 id）區分 */
const PRODUCT_SOURCE_PREFIX = 'shopee-'
const CATEGORY_SOURCE_PREFIX = 'shopee-cat-'
const SHOPEE_IMAGE_PREFIX = '/uploads/shopee/'
const LEGACY_IMAGE_PREFIX = '/uploads/seed/'

const CATALOG_ONLY = process.argv.includes('--catalog-only')

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s/\\｜|]+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
}

/** 以字元（code point）截斷 —— 一般的 slice 會把 emoji 切成半個 surrogate，Prisma 送不出去 */
function takeChars(input: string, max: number): string {
  return Array.from(input).slice(0, max).join('')
}

type BrandMeta ={ slug: string; description: string; descriptionEn: string; sortOrder: number }

const BRAND_META: Record<string, BrandMeta> = {
  LUNALUZ: {
    slug: 'lunaluz',
    description: '韓國 LUNALUZ，優雅細緻的睡衣選品。',
    descriptionEn: 'LUNALUZ of Korea — elegant, finely made sleepwear.',
    sortOrder: 1,
  },
  ULLALA: {
    slug: 'ullala',
    description: '韓國 ULLALA，經典舒適的睡衣套裝。',
    descriptionEn: 'ULLALA of Korea — classic, comfortable pyjama sets.',
    sortOrder: 2,
  },
  MMOM: {
    slug: 'mmom',
    description: '韓國 MMOM，柔軟親膚的日常睡衣。',
    descriptionEn: 'MMOM of Korea — soft, skin-friendly everyday sleepwear.',
    sortOrder: 3,
  },
  BALCONY: {
    slug: 'balcony',
    description: '韓國 BALCONY，質感純棉與蕾絲工藝。',
    descriptionEn: 'BALCONY of Korea — quality cotton and lace craftsmanship.',
    sortOrder: 4,
  },
  KOZNOK: {
    slug: 'koznok',
    description: '韓國 KOZNOK 居家睡衣。',
    descriptionEn: 'KOZNOK of Korea — loungewear and sleepwear.',
    sortOrder: 5,
  },
  VIVIHOME: {
    slug: 'vivihome',
    description: '韓國 VIVIHOME，居家生活的溫柔提案。',
    descriptionEn: 'VIVIHOME of Korea — a gentler take on life at home.',
    sortOrder: 6,
  },
  'The Warmth': {
    slug: 'the-warmth',
    description: '韓國 The Warmth 手作圍裙與居家用品。',
    descriptionEn: 'The Warmth of Korea — handmade aprons and home goods.',
    sortOrder: 7,
  },
  FOTL: {
    slug: 'fotl',
    description: 'FOTL 香氛與手工飾品。',
    descriptionEn: 'FOTL — fragrance and handmade jewellery.',
    sortOrder: 8,
  },
  'Maison de Paris': {
    slug: 'maison-de-paris',
    description: '韓國 Maison de Paris 寢具與家飾。',
    descriptionEn: 'Maison de Paris of Korea — bedding and home décor.',
    sortOrder: 9,
  },
}

async function loadShopeeExport(): Promise<ShopeeExport | null> {
  if (!existsSync(DATA_FILE)) return null
  return JSON.parse(await readFile(DATA_FILE, 'utf8')) as ShopeeExport
}

// ---------------------------------------------------------------------------

/**
 * 清掉舊的 sagan.com.tw 爬蟲資料（他人著作權素材，只是開發期的假資料）。
 *
 * 只動「有 sourceId 但不是蝦皮來的」商品與分類 —— 後台手動建立的商品 sourceId 是 null，不受影響。
 * 已成立的訂單不會壞：OrderItem 是下單當下的快照，variantId 會被設成 null。
 */
async function purgeLegacyCatalog() {
  const products = await db.product.deleteMany({
    where: { sourceId: { not: null }, NOT: { sourceId: { startsWith: PRODUCT_SOURCE_PREFIX } } },
  })
  const categories = await db.category.deleteMany({
    where: { sourceId: { not: null }, NOT: { sourceId: { startsWith: CATEGORY_SOURCE_PREFIX } } },
  })
  if (products.count + categories.count > 0) {
    console.log(`  清除舊爬蟲資料：商品 ${products.count} 件、分類 ${categories.count} 個`)
  }
}

/**
 * 舊爬蟲的圖片在 public/uploads/seed/，確定沒有任何地方再指向它才刪。
 * 訂單明細也算 —— 它存的是下單當下的圖片網址，刪了舊訂單的縮圖就破了。
 */
async function removeLegacyImages() {
  if (!existsSync(LEGACY_IMAGE_DIR)) return
  const [images, banners, orderItems] = await Promise.all([
    db.productImage.count({ where: { url: { startsWith: LEGACY_IMAGE_PREFIX } } }),
    db.banner.count({ where: { imageUrl: { startsWith: LEGACY_IMAGE_PREFIX } } }),
    db.orderItem.count({ where: { imageUrl: { startsWith: LEGACY_IMAGE_PREFIX } } }),
  ])
  if (images + banners + orderItems > 0) return
  await rm(LEGACY_IMAGE_DIR, { recursive: true, force: true })
  console.log('  已刪除 public/uploads/seed/（舊爬蟲圖片）')
}

async function seedBrands(products: ShopeeProduct[]) {
  const names = new Set(products.map((p) => p.brandName).filter((n): n is string => Boolean(n)))
  const idByName = new Map<string, string>()

  for (const name of names) {
    const meta: BrandMeta = BRAND_META[name] ?? {
      slug: slugify(name),
      description: '',
      descriptionEn: '',
      sortOrder: 99,
    }
    const fields = {
      name,
      description: meta.description,
      descriptionEn: meta.descriptionEn || null,
      sortOrder: meta.sortOrder,
    }
    const brand = await db.brand.upsert({
      where: { slug: meta.slug },
      update: fields,
      create: { slug: meta.slug, ...fields },
    })
    idByName.set(name, brand.id)
  }

  console.log(`  品牌 ${idByName.size} 個`)
  return idByName
}

async function seedCategories(categories: ShopeeCategory[]) {
  const idByKey = new Map<string, string>()

  for (const [index, cat] of categories.entries()) {
    const sourceId = `${CATEGORY_SOURCE_PREFIX}${cat.key}`
    const fields = { name: cat.name, nameEn: cat.nameEn, sortOrder: index }
    const record = await db.category.upsert({
      where: { sourceId },
      update: fields,
      create: { sourceId, slug: cat.key, ...fields },
    })
    idByKey.set(cat.key, record.id)
  }

  console.log(`  分類 ${idByKey.size} 個`)
  return idByKey
}

/**
 * 同一張圖的識別碼：檔名（不含 .webp）的末 8 碼。
 * 舊檔名是蝦皮圖片 ID 本身，新檔名是 <商品名>-<用途>-<ID 末 8 碼>，兩種取出來的值相同。
 */
function imageTagOf(url: string): string {
  return decodeURIComponent(url.split('/').pop() ?? '').replace(/\.webp$/, '').slice(-8)
}

async function relinkOrderImages(tx: Prisma.TransactionClient, productId: string, images: ShopeeImage[]) {
  const previous = await tx.productImage.findMany({
    where: { productId, url: { startsWith: SHOPEE_IMAGE_PREFIX } },
    select: { url: true },
  })
  const current = new Map(images.map((img) => [imageTagOf(img.url), img.url]))
  for (const { url } of previous) {
    const next = current.get(imageTagOf(url))
    if (next && next !== url) {
      await tx.orderItem.updateMany({ where: { imageUrl: url }, data: { imageUrl: next } })
    }
  }
}

async function seedProducts(
  data: ShopeeExport,
  brandIds: Map<string, string>,
  categoryIds: Map<string, string>,
) {
  // 蝦皮商品 ID 越大越新；用匯入時間往回排，讓「最新上架」的順序跟蝦皮一致，重跑結果也一樣
  const sorted = [...data.products].sort((a, b) => (BigInt(b.sourceId) > BigInt(a.sourceId) ? 1 : -1))
  const base = new Date(data.importedAt).getTime()
  const shopeeCategoryIds = [...categoryIds.values()]
  const seen: string[] = []

  for (const [index, product] of sorted.entries()) {
    const sourceId = `${PRODUCT_SOURCE_PREFIX}${product.sourceId}`
    seen.push(sourceId)

    const fields = {
      name: product.name,
      summary: product.summary || null,
      descriptionHtml: product.descriptionHtml || null,
      brandId: product.brandName ? (brandIds.get(product.brandName) ?? null) : null,
      basePrice: Math.min(...product.variants.map((v) => v.price)),
      compareAtPrice: null,
      sourceUrl: product.sourceUrl,
      status: product.status,
      publishedAt: new Date(base - index * 1000),
      seoTitle: product.name,
      seoDescription: takeChars(product.summary, 155) || null,
    }

    await db.$transaction(async (tx) => {
      const existing = await tx.product.findUnique({ where: { sourceId }, select: { id: true } })
      const slugBase = takeChars(slugify(product.name), 40).replace(/-+$/, '') || 'product'
      const record = existing
        ? await tx.product.update({ where: { id: existing.id }, data: fields })
        : await tx.product.create({ data: { ...fields, sourceId, slug: `${slugBase}-${product.sourceId}` } })

      // 匯入程式會隨商品名稱改檔名；訂單明細存的是下單當下的網址，跟著換成新檔名才不會破圖
      if (existing) await relinkOrderImages(tx, existing.id, product.images)

      // 只換掉匯入的圖，後台自己上傳的（/uploads/products/）留著
      await tx.productImage.deleteMany({
        where: { productId: record.id, url: { startsWith: SHOPEE_IMAGE_PREFIX } },
      })
      if (product.images.length > 0) {
        await tx.productImage.createMany({
          data: product.images.map((img, i) => ({
            productId: record.id,
            url: img.url,
            alt: product.name,
            width: img.width || null,
            height: img.height || null,
            sortOrder: i,
          })),
        })
      }

      const skus: string[] = []
      for (const [i, v] of product.variants.entries()) {
        const sku = `SP-${v.sourceId}`
        skus.push(sku)
        const variant = {
          name: v.name,
          options: v.options as Prisma.InputJsonValue,
          price: v.price,
          stock: v.stock,
          preorderEnabled: v.preorder,
          isActive: true,
          sortOrder: i,
        }
        await tx.productVariant.upsert({
          where: { sku },
          update: variant,
          create: { ...variant, sku, productId: record.id },
        })
      }
      // 蝦皮上已經刪掉的規格：停用而不刪，歷史訂單與購物車可能還指著它
      await tx.productVariant.updateMany({
        where: { productId: record.id, sku: { notIn: skus } },
        data: { isActive: false },
      })

      await tx.productCategory.deleteMany({
        where: { productId: record.id, categoryId: { in: shopeeCategoryIds } },
      })
      const categoryId = categoryIds.get(product.categoryKey)
      if (categoryId) {
        await tx.productCategory.create({ data: { productId: record.id, categoryId } })
      }
    })

    if ((index + 1) % 200 === 0) console.log(`  商品 ${index + 1}/${sorted.length}`)
  }

  // 之前匯入過、這次匯出檔裡沒有的（蝦皮上刪掉了）：刪除。
  // 已成立的訂單不受影響（OrderItem 是快照，variantId 設成 null）；
  // 有顧客評論的改成下架 —— 刪商品會連評論一起刪掉。
  const gone = { sourceId: { startsWith: PRODUCT_SOURCE_PREFIX, notIn: seen } }
  // 被組合用到的也改成下架：組合項目綁著商品（Restrict），刪掉會讓組合少一件
  const archived = await db.product.updateMany({
    where: {
      ...gone,
      OR: [{ reviews: { some: {} } }, { bundleItems: { some: {} } }],
      status: { not: 'ARCHIVED' },
    },
    data: { status: 'ARCHIVED' },
  })
  const deleted = await db.product.deleteMany({
    where: { ...gone, reviews: { none: {} }, bundleItems: { none: {} } },
  })

  // 商品刪光的品牌也刪掉，否則首頁與關於頁會列出「0 件」的品牌。後台上過封面圖的品牌保留
  const emptyBrands = await db.brand.deleteMany({ where: { products: { none: {} }, imageUrl: null } })

  const active = sorted.filter((p) => p.status === 'ACTIVE').length
  console.log(`  商品 ${sorted.length} 件（上架 ${active}、下架 ${sorted.length - active}）`)
  if (deleted.count > 0) console.log(`  蝦皮上已不存在而刪除：${deleted.count} 件`)
  if (archived.count > 0) console.log(`  蝦皮上已不存在但有顧客評論，改成下架：${archived.count} 件`)
  if (emptyBrands.count > 0) console.log(`  刪除沒有商品的品牌：${emptyBrands.count} 個`)
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
  // Hero 圖沿用最新上架商品的主圖，這樣不需要另外準備素材
  const first = await db.productImage.findFirst({
    where: { product: { status: 'ACTIVE' } },
    orderBy: [{ product: { publishedAt: 'desc' } }, { sortOrder: 'asc' }],
    select: { url: true },
  })
  if (!first) return

  // 後台換過圖（不再是 seed 放的商品圖）就不動，重跑 seed 不能蓋掉店家自己挑的 Hero
  const current = await db.banner.findUnique({ where: { id: 'seed-hero' }, select: { imageUrl: true } })
  const seedOwned =
    !current ||
    current.imageUrl.startsWith(SHOPEE_IMAGE_PREFIX) ||
    current.imageUrl.startsWith(LEGACY_IMAGE_PREFIX)
  if (!seedOwned) {
    console.log('  首頁 Hero 已在後台換過圖，略過')
    return
  }

  await db.banner.upsert({
    where: { id: 'seed-hero' },
    update: { imageUrl: first.url },
    create: {
      id: 'seed-hero',
      title: '讓自己幸福，是他唯一的道德觀',
      subtitle: '嚴選韓國睡衣、寢具與家居飾品',
      titleEn: 'Your own happiness is the only moral compass',
      subtitleEn: 'Curated Korean sleepwear, bedding and home goods',
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
  console.log(`\n=== 開始 seed${CATALOG_ONLY ? '（只更新商品）' : ''} ===\n`)

  if (!CATALOG_ONLY && process.env.NODE_ENV === 'production' && !process.env.SEED_ADMIN_PASSWORD) {
    // 沒設就會用預設的 admin1234 —— 在正式站等於把管理員密碼公開
    throw new Error('正式環境跑完整 seed 必須設定 SEED_ADMIN_PASSWORD；只更新商品請加 --catalog-only')
  }

  const data = await loadShopeeExport()

  if (!data) {
    if (CATALOG_ONLY) {
      // 清舊商品之前先確定有新資料可以補上，否則正式站會變成空的賣場
      throw new Error(`找不到 ${path.relative(ROOT, DATA_FILE)}，沒有商品資料可更新`)
    }
    console.log('找不到 prisma/seed-data/shopee.json，只建立帳號與優惠券。')
    console.log('要灌入商品資料請先執行： npm run import:shopee -- "<蝦皮匯出檔資料夾>"\n')
    await seedAccounts()
    await seedCoupons()
    console.log('\n=== 完成 ===\n')
    return
  }

  console.log(`資料來源：蝦皮賣場 ${data.shopId}（匯出檔 ${data.sourceFiles.join('、')}）\n`)

  await purgeLegacyCatalog()
  const brandIds = await seedBrands(data.products)
  const categoryIds = await seedCategories(data.categories)
  await seedProducts(data, brandIds, categoryIds)
  if (!CATALOG_ONLY) {
    await seedAccounts()
    await seedCoupons()
  }
  await seedBanners()
  await removeLegacyImages()

  console.log('\n=== 完成 ===\n')
}

main()
  .catch((err) => {
    console.error('seed 失敗：', err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
