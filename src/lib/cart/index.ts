import 'server-only'
import { randomUUID } from 'node:crypto'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'
import {
  CART_COOKIE,
  CART_COOKIE_MAX_AGE,
  CART_INCLUDE,
  absorbAnonCart,
  readAnonId,
  type CartWithItems,
} from './shared'

export { CART_COOKIE, claimAnonCart } from './shared'
export type { CartWithItems } from './shared'

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
 * 唯讀路徑要讀哪一台車。
 *
 * 會員車是空的時候還會回頭看一眼匿名車：購物車在登入當下就併好了
 * （見 shared.ts 的 claimAnonCart），這裡是那次合併沒跑到時的保險 ——
 * 東西至少不會從畫面上消失，下一個 Server Action 會把它正式併進會員車。
 */
async function resolveReadableCartId(): Promise<string | null> {
  const [session, anonId] = await Promise.all([auth(), readAnonId()])

  const peek = (where: { userId: string } | { anonId: string }) =>
    db.cart.findUnique({ where, select: { id: true, _count: { select: { items: true } } } })

  const userCart = session?.user?.id ? await peek({ userId: session.user.id }) : null
  if (userCart && userCart._count.items > 0) return userCart.id

  const anonCart = anonId ? await peek({ anonId }) : null
  if (anonCart && anonCart._count.items > 0) return anonCart.id

  return userCart?.id ?? anonCart?.id ?? null
}

/**
 * 唯讀取得購物車，給 Server Component 用。
 *
 * 這裡不寫 cookie 也不建立資料列 —— Next.js 不允許在 render 階段寫 cookie，
 * 而且 GET 一個頁面不該產生副作用。anonId 由 proxy.ts 事先發放。
 */
export async function getCart(): Promise<CartWithItems> {
  const cartId = await resolveReadableCartId()
  if (!cartId) return emptyCart()

  const cart = await db.cart.findUnique({ where: { id: cartId }, include: CART_INCLUDE })
  return cart ?? emptyCart()
}

/**
 * 取得購物車，沒有就建一個。**只能在 Server Action 或 Route Handler 裡呼叫**
 * （會寫 cookie 與建立資料列）。
 *
 * 未登入時以 cookie 裡的 anonId 認人；登入後把 anon 車併進會員車，
 * 讓「先加購物車再登入」不會掉東西。合併本身在登入當下就做過一次了，
 * 這裡是那次沒成功（例如 signIn event 拋錯）時的第二次機會。
 */
export async function getOrCreateCart(): Promise<CartWithItems> {
  const session = await auth()
  const jar = await cookies()
  const anonId = jar.get(CART_COOKIE)?.value

  if (session?.user?.id) {
    const userId = session.user.id
    const merged = anonId ? await absorbAnonCart(userId, anonId) : null
    if (merged) return merged

    const cart = await db.cart.findUnique({ where: { userId }, include: CART_INCLUDE })
    return cart ?? db.cart.create({ data: { userId }, include: CART_INCLUDE })
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

/** 只算件數，給 header 的紅點用（不需要撈整台車）。 */
export async function getCartItemCount(): Promise<number> {
  const cartId = await resolveReadableCartId()
  if (!cartId) return 0

  const agg = await db.cartItem.aggregate({
    where: { cartId },
    _sum: { qty: true },
  })
  return agg._sum.qty ?? 0
}

/** 可售數量 = 在庫 − 已被未付款訂單佔住的 */
export function availableStock(variant: { stock: number; reservedStock: number }): number {
  return Math.max(0, variant.stock - variant.reservedStock)
}
