import 'server-only'
import { cache } from 'react'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

export const PRODUCTS_PER_PAGE = 24

/** 商品卡片需要的最小欄位集合 */
export const PRODUCT_CARD_SELECT = {
  id: true,
  slug: true,
  name: true,
  nameEn: true,
  basePrice: true,
  compareAtPrice: true,
  brand: { select: { name: true, slug: true } },
  images: { select: { url: true, alt: true }, orderBy: { sortOrder: 'asc' }, take: 2 },
  variants: { select: { stock: true, reservedStock: true, isActive: true } },
} satisfies Prisma.ProductSelect

export type ProductCardData = Prisma.ProductGetPayload<{ select: typeof PRODUCT_CARD_SELECT }>

export type SortKey = 'newest' | 'price-asc' | 'price-desc' | 'name-asc'

const ORDER_BY: Record<SortKey, Prisma.ProductOrderByWithRelationInput[]> = {
  newest: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
  'price-asc': [{ basePrice: 'asc' }],
  'price-desc': [{ basePrice: 'desc' }],
  'name-asc': [{ name: 'asc' }],
}

export function parseSort(raw: string | undefined): SortKey {
  return raw && raw in ORDER_BY ? (raw as SortKey) : 'newest'
}

export interface ProductListFilters {
  q?: string
  brandSlugs?: string[]
  categorySlug?: string
  minPrice?: number
  maxPrice?: number
  sort?: SortKey
  page?: number
}

function buildWhere(filters: ProductListFilters): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = { status: 'ACTIVE' }

  if (filters.q) {
    // 中文沒有詞邊界，全文檢索意義不大，用 contains 做子字串比對就夠了
    where.OR = [
      { name: { contains: filters.q, mode: 'insensitive' } },
      { summary: { contains: filters.q, mode: 'insensitive' } },
      { brand: { name: { contains: filters.q, mode: 'insensitive' } } },
    ]
  }

  if (filters.brandSlugs?.length) {
    where.brand = { slug: { in: filters.brandSlugs } }
  }

  if (filters.categorySlug) {
    where.categories = { some: { category: { slug: filters.categorySlug } } }
  }

  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    where.basePrice = {
      ...(filters.minPrice !== undefined ? { gte: filters.minPrice } : {}),
      ...(filters.maxPrice !== undefined ? { lte: filters.maxPrice } : {}),
    }
  }

  return where
}

export async function listProducts(filters: ProductListFilters) {
  const page = Math.max(1, filters.page ?? 1)
  const where = buildWhere(filters)
  const orderBy = ORDER_BY[filters.sort ?? 'newest']

  const [items, total] = await Promise.all([
    db.product.findMany({
      where,
      orderBy,
      select: PRODUCT_CARD_SELECT,
      skip: (page - 1) * PRODUCTS_PER_PAGE,
      take: PRODUCTS_PER_PAGE,
    }),
    db.product.count({ where }),
  ])

  return {
    items,
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / PRODUCTS_PER_PAGE)),
  }
}

/** 商品頁只顯示最新這幾則評論；總平均與總則數另外用 getProductReviewStats 算。 */
export const REVIEWS_ON_PRODUCT_PAGE = 20

/**
 * 用 React cache 包起來 —— 商品頁的 generateMetadata 與頁面本身都會呼叫，
 * 沒有包的話同一個請求會查兩次資料庫（Next 的 metadata 指南明講這件事）。
 */
export const getProductBySlug = cache(async (slug: string) => {
  return db.product.findFirst({
    where: { slug, status: 'ACTIVE' },
    include: {
      brand: true,
      images: { orderBy: { sortOrder: 'asc' } },
      variants: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
      categories: { include: { category: true } },
      reviews: {
        where: { status: 'APPROVED' },
        orderBy: { createdAt: 'desc' },
        take: REVIEWS_ON_PRODUCT_PAGE,
        include: { user: { select: { name: true, image: true } } },
      },
    },
  })
})

export type ProductDetail = NonNullable<Awaited<ReturnType<typeof getProductBySlug>>>

/**
 * 全部已核准評論的平均分與則數。
 *
 * 不能直接拿 product.reviews 算 —— 那個查詢有 `take: 20`，超過 20 則之後
 * 算出來的是「最新 20 則的平均」，則數也永遠停在 20。頁面上顯示的分數
 * 必須等於送給 Google 的 aggregateRating，兩邊對不上會被判定為欺騙性標記，
 * 所以平均與則數一律以這裡為準。
 */
export const getProductReviewStats = cache(async (productId: string) => {
  const result = await db.review.aggregate({
    where: { productId, status: 'APPROVED' },
    _avg: { rating: true },
    _count: { _all: true },
  })

  const total = result._count._all
  return {
    total,
    // 一則都沒有時 _avg.rating 是 null
    average: total > 0 && result._avg.rating ? Math.round(result._avg.rating * 10) / 10 : 0,
  }
})

/** 同分類的其他商品，湊不滿就用同品牌補 */
export async function getRelatedProducts(product: ProductDetail, take = 4) {
  const categoryIds = product.categories.map((c) => c.categoryId)

  const byCategory = categoryIds.length
    ? await db.product.findMany({
        where: {
          status: 'ACTIVE',
          id: { not: product.id },
          categories: { some: { categoryId: { in: categoryIds } } },
        },
        select: PRODUCT_CARD_SELECT,
        orderBy: { publishedAt: 'desc' },
        take,
      })
    : []

  if (byCategory.length >= take || !product.brandId) return byCategory

  const seen = new Set([product.id, ...byCategory.map((p) => p.id)])
  const byBrand = await db.product.findMany({
    where: { status: 'ACTIVE', brandId: product.brandId, id: { notIn: [...seen] } },
    select: PRODUCT_CARD_SELECT,
    orderBy: { publishedAt: 'desc' },
    take: take - byCategory.length,
  })

  return [...byCategory, ...byBrand]
}

/** 同樣被 generateMetadata 與頁面各呼叫一次，理由見 getProductBySlug */
export const getCategoryBySlug = cache(async (slug: string) => {
  return db.category.findUnique({
    where: { slug },
    // 上架商品數，給 metadata 的描述用（「精選 N 款…」）
    include: {
      _count: { select: { products: { where: { product: { status: 'ACTIVE' } } } } },
    },
  })
})

export async function listBrands() {
  return db.brand.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      slug: true,
      name: true,
      description: true,
      descriptionEn: true,
      _count: { select: { products: { where: { status: 'ACTIVE' } } } },
    },
  })
}

export async function listCategories() {
  return db.category.findMany({
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: {
      slug: true,
      name: true,
      nameEn: true,
      _count: { select: { products: true } },
    },
  })
}

/** 首頁精選：最新上架且有庫存的商品 */
export async function getFeaturedProducts(take = 8) {
  return db.product.findMany({
    where: { status: 'ACTIVE', variants: { some: { stock: { gt: 0 }, isActive: true } } },
    orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    select: PRODUCT_CARD_SELECT,
    take,
  })
}

export async function getHeroBanner() {
  return db.banner.findFirst({
    where: { placement: 'hero', isActive: true },
    orderBy: { sortOrder: 'asc' },
  })
}

/** 商品是否還有任何一個變體可以買 */
export function isPurchasable(product: {
  variants: { stock: number; reservedStock: number; isActive: boolean }[]
}): boolean {
  return product.variants.some((v) => v.isActive && v.stock - v.reservedStock > 0)
}
