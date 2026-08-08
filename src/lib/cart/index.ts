import 'server-only'
import { randomUUID } from 'node:crypto'
import { cookies } from 'next/headers'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'

export const CART_COOKIE = 'sagon_cart'
const CART_COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 天

export type CartWithItems = Prisma.CartGetPayload<{
  include: {
    items: {
      include: {
        variant: {
          include: {
            product: { include: { images: true; brand: true } }
          }
        }
      }
    }
  }
}>

const CART_INCLUDE = {
  items: {
    orderBy: { createdAt: 'asc' },
    include: {
      variant: {
        include: {
          product: {
            include: {
              images: { orderBy: { sortOrder: 'asc' }, take: 1 },
              brand: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.CartInclude

/** 空車的替身，讓頁面不用到處判斷 null */
function emptyCart(): CartWithItems {
  return {
    id: '',
    userId: null,
    anonId: null,
    couponCode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [],
  } as unknown as CartWithItems
}

/**
 * 唯讀取得購物車，給 Server Component 用。
 *
 * 這裡不寫 cookie 也不建立資料列 —— Next.js 不允許在 render 階段寫 cookie，
 * 而且 GET 一個頁面不該產生副作用。anonId 由 proxy.ts 事先發放。
 */
export async function getCart(): Promise<CartWithItems> {
  const session = await auth()
  const jar = await cookies()
  const anonId = jar.get(CART_COOKIE)?.value

  if (session?.user?.id) {
    const cart = await db.cart.findUnique({
      where: { userId: session.user.id },
      include: CART_INCLUDE,
    })
    if (cart) return cart
  }

  if (anonId) {
    const cart = await db.cart.findUnique({ where: { anonId }, include: CART_INCLUDE })
    if (cart) return cart
  }

  return emptyCart()
}

/**
 * 取得購物車，沒有就建一個。**只能在 Server Action 或 Route Handler 裡呼叫**
 * （會寫 cookie 與建立資料列）。
 *
 * 未登入時以 cookie 裡的 anonId 認人；登入後把 anon 車併進會員車，
 * 讓「先加購物車再登入」不會掉東西。
 */
export async function getOrCreateCart(): Promise<CartWithItems> {
  const session = await auth()
  const jar = await cookies()
  const anonId = jar.get(CART_COOKIE)?.value

  if (session?.user?.id) {
    const userId = session.user.id
    let cart = await db.cart.findUnique({ where: { userId }, include: CART_INCLUDE })

    // 剛登入：把匿名車的東西搬過來
    if (anonId) {
      const anonCart = await db.cart.findUnique({ where: { anonId }, include: CART_INCLUDE })
      if (anonCart && anonCart.items.length > 0) {
        cart = await mergeCarts(anonCart, cart, userId)
      } else if (anonCart) {
        await db.cart.delete({ where: { id: anonCart.id } }).catch(() => {})
      }
    }

    if (!cart) {
      cart = await db.cart.create({ data: { userId }, include: CART_INCLUDE })
    }
    return cart
  }

  if (anonId) {
    const existing = await db.cart.findUnique({ where: { anonId }, include: CART_INCLUDE })
    if (existing) return existing
    return db.cart.create({ data: { anonId }, include: CART_INCLUDE })
  }

  // proxy 沒跑到（例如直接打 API）時的後備路徑
  const newAnonId = randomUUID()
  jar.set(CART_COOKIE, newAnonId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: CART_COOKIE_MAX_AGE,
  })
  return db.cart.create({ data: { anonId: newAnonId }, include: CART_INCLUDE })
}

async function mergeCarts(
  anonCart: CartWithItems,
  userCart: CartWithItems | null,
  userId: string,
): Promise<CartWithItems> {
  if (!userCart) {
    // 沒有會員車就直接把匿名車認領過來，省一輪搬移
    await db.cart.update({
      where: { id: anonCart.id },
      data: { userId, anonId: null },
    })
    return db.cart.findUniqueOrThrow({ where: { id: anonCart.id }, include: CART_INCLUDE })
  }

  await db.$transaction(async (tx) => {
    for (const item of anonCart.items) {
      await tx.cartItem.upsert({
        where: { cartId_variantId: { cartId: userCart.id, variantId: item.variantId } },
        // 兩邊都有同一個變體時相加，而不是覆蓋
        update: { qty: { increment: item.qty } },
        create: { cartId: userCart.id, variantId: item.variantId, qty: item.qty },
      })
    }
    await tx.cart.delete({ where: { id: anonCart.id } })
  })

  return db.cart.findUniqueOrThrow({ where: { id: userCart.id }, include: CART_INCLUDE })
}

/** 只算件數，給 header 的紅點用（不需要撈整台車）。 */
export async function getCartItemCount(): Promise<number> {
  const session = await auth()
  const jar = await cookies()
  const anonId = jar.get(CART_COOKIE)?.value

  const where: Prisma.CartWhereInput | null = session?.user?.id
    ? { userId: session.user.id }
    : anonId
      ? { anonId }
      : null
  if (!where) return 0

  const cart = await db.cart.findFirst({ where, select: { id: true } })
  if (!cart) return 0

  const agg = await db.cartItem.aggregate({
    where: { cartId: cart.id },
    _sum: { qty: true },
  })
  return agg._sum.qty ?? 0
}

/** 可售數量 = 在庫 − 已被未付款訂單佔住的 */
export function availableStock(variant: { stock: number; reservedStock: number }): number {
  return Math.max(0, variant.stock - variant.reservedStock)
}
