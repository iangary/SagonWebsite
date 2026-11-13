import 'server-only'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { availableStock } from '@/lib/cart'
import { localizedName, pickLocalized } from '@/lib/i18n/localized'
import { bundleOriginalRange, matchBundles, type BundleMatchResult, type BundleRule } from './match'

export type { AppliedBundle, BundleMatchResult } from './match'

type Db = Prisma.TransactionClient | typeof db

/**
 * 組合「現在能不能用」：上架中、至少一項，而且每一項的商品都還在架上、指定的規格也還開著。
 * 少一件就不成組合 —— 寧可整組不套用，也不要讓顧客用組合價買到缺一件的內容。
 */
const RULE_SELECT = {
  id: true,
  name: true,
  nameEn: true,
  price: true,
  items: {
    orderBy: { sortOrder: 'asc' },
    select: {
      productId: true,
      variantId: true,
      qty: true,
      product: { select: { status: true } },
      variant: { select: { isActive: true } },
    },
  },
} satisfies Prisma.BundleSelect

type RuleRow = Prisma.BundleGetPayload<{ select: typeof RULE_SELECT }>

function isUsable(bundle: {
  items: {
    qty: number
    product: { status: string }
    variant: { isActive: boolean } | null
  }[]
}): boolean {
  return (
    bundle.items.length > 0 &&
    bundle.items.every(
      (item) =>
        item.qty > 0 &&
        item.product.status === 'ACTIVE' &&
        (item.variant === null || item.variant.isActive),
    )
  )
}

/**
 * 目前可以套用的組合，依後台排序。
 *
 * name 預設是中文（訂單快照用）；傳 locale 時換成該語系的名稱（畫面用）。
 */
export async function getActiveBundleRules(
  options: { locale?: string; client?: Db } = {},
): Promise<BundleRule[]> {
  const client = options.client ?? db
  const rows: RuleRow[] = await client.bundle.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: RULE_SELECT,
  })

  return rows.filter(isUsable).map((row) => ({
    id: row.id,
    name: options.locale ? localizedName(options.locale, row) : row.name,
    price: row.price,
    items: row.items.map((item) => ({
      productId: item.productId,
      variantId: item.variantId,
      qty: item.qty,
    })),
  }))
}

/** 購物車品項的最小形狀：每一行都要知道規格、所屬商品與資料庫裡的單價。 */
export interface CartLineForBundles {
  variantId: string
  qty: number
  variant: { productId: string; price: number }
}

/**
 * 替購物車配組合。金額一律取資料庫裡的規格售價 —— 前端送來的數字不參與計算。
 */
export async function matchCartBundles(
  items: CartLineForBundles[],
  options: { locale?: string; client?: Db } = {},
): Promise<BundleMatchResult> {
  if (items.length === 0) return { applied: [], discount: 0 }
  const rules = await getActiveBundleRules(options)
  if (rules.length === 0) return { applied: [], discount: 0 }

  return matchBundles(
    items.map((item) => ({
      variantId: item.variantId,
      productId: item.variant.productId,
      unitPrice: item.variant.price,
      qty: item.qty,
    })),
    rules,
  )
}

// ---------------------------------------------------------------------------
// 前台顯示
// ---------------------------------------------------------------------------

const STOREFRONT_SELECT = {
  id: true,
  slug: true,
  name: true,
  nameEn: true,
  description: true,
  descriptionEn: true,
  price: true,
  items: {
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      qty: true,
      variantId: true,
      variant: { select: { isActive: true } },
      product: {
        select: {
          id: true,
          slug: true,
          name: true,
          nameEn: true,
          status: true,
          images: {
            orderBy: { sortOrder: 'asc' },
            take: 1,
            select: { url: true },
          },
          variants: {
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
            select: {
              id: true,
              name: true,
              price: true,
              stock: true,
              reservedStock: true,
              preorderEnabled: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.BundleSelect

type StorefrontRow = Prisma.BundleGetPayload<{
  select: typeof STOREFRONT_SELECT
}>

export interface StorefrontBundleVariant {
  id: string
  name: string
  price: number
  available: number
  preorder: boolean
}

export interface StorefrontBundleItem {
  id: string
  qty: number
  productId: string
  productSlug: string
  productName: string
  imageUrl: string | null
  /** 指定規格時只有那一個；任一規格時是該商品所有開著的規格 */
  variants: StorefrontBundleVariant[]
  fixedVariant: boolean
}

export interface StorefrontBundle {
  id: string
  slug: string
  name: string
  description: string | null
  price: number
  /** 原價合計範圍：「任一規格」的項目各規格價格不同時 min < max */
  originalMin: number
  originalMax: number
  /** 至少省多少（= originalMin - price） */
  saving: number
  items: StorefrontBundleItem[]
  /** 每一項都至少有一個買得到的規格（有現貨或開放預購） */
  purchasable: boolean
}

function toStorefront(locale: string, row: StorefrontRow): StorefrontBundle | null {
  if (!isUsable(row)) return null

  const items: StorefrontBundleItem[] = row.items.map((item) => {
    const variants = item.product.variants
      .filter((v) => item.variantId === null || v.id === item.variantId)
      .map((v) => ({
        id: v.id,
        name: v.name,
        price: v.price,
        available: availableStock(v),
        preorder: v.preorderEnabled,
      }))
    return {
      id: item.id,
      qty: item.qty,
      productId: item.product.id,
      productSlug: item.product.slug,
      productName: localizedName(locale, item.product),
      imageUrl: item.product.images[0]?.url ?? null,
      variants,
      fixedVariant: item.variantId !== null,
    }
  })

  if (items.some((item) => item.variants.length === 0)) return null

  const range = bundleOriginalRange(
    items.map((item) => ({
      qty: item.qty,
      prices: item.variants.map((v) => v.price),
    })),
  )
  // 連最貴的組法都沒省到，這個組合不會套用，前台也就不該打廣告
  if (range.max <= row.price) return null

  return {
    id: row.id,
    slug: row.slug,
    name: localizedName(locale, row),
    description: row.description ? pickLocalized(locale, row.description, row.descriptionEn) : null,
    price: row.price,
    originalMin: range.min,
    originalMax: range.max,
    saving: Math.max(0, range.min - row.price),
    items,
    purchasable: items.every((item) =>
      item.variants.some((v) => v.preorder || v.available >= item.qty),
    ),
  }
}

/** 前台列出的組合；傳 productId 時只回含這件商品的（商品頁的「組合購買更划算」）。 */
export async function getStorefrontBundles(
  locale: string,
  options: { productId?: string } = {},
): Promise<StorefrontBundle[]> {
  const rows = await db.bundle.findMany({
    where: {
      isActive: true,
      ...(options.productId ? { items: { some: { productId: options.productId } } } : {}),
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: STOREFRONT_SELECT,
  })
  return rows
    .map((row) => toStorefront(locale, row))
    .filter((b): b is StorefrontBundle => b !== null)
}

export async function getStorefrontBundleBySlug(
  locale: string,
  slug: string,
): Promise<StorefrontBundle | null> {
  const row = await db.bundle.findFirst({
    where: { slug, isActive: true },
    select: STOREFRONT_SELECT,
  })
  return row ? toStorefront(locale, row) : null
}
