import 'server-only'
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

export async function getProductBySlug(slug: string) {
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
        take: 20,
        include: { user: { select: { name: true, image: true } } },
      },
    },
  })
}

export type ProductDetail = NonNullable<Awaited<ReturnType<typeof getProductBySlug>>>

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

export async function getCategoryBySlug(slug: string) {
  return db.category.findUnique({ where: { slug } })
}

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
