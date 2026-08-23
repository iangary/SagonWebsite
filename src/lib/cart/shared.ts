import 'server-only'
import { cookies } from 'next/headers'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

/**
 * 購物車裡「不需要知道誰登入」的那一半。
 *
 * 拆出來是為了讓 src/lib/auth 的 signIn event 能在登入當下呼叫 claimAnonCart()——
 * 從 src/lib/cart/index.ts 匯入會繞回 @/lib/auth 變成 import 循環。
 * 這個檔只碰 db 與 cookie，永遠不要在這裡呼叫 auth()。
 */

export const CART_COOKIE = 'sagon_cart'
export const CART_COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 天

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

export const CART_INCLUDE = {
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

/** 訪客的匿名識別碼；proxy.ts 保證每個人一進站就有一組。 */
export async function readAnonId(): Promise<string | undefined> {
  const jar = await cookies()
  return jar.get(CART_COOKIE)?.value
}

/**
 * 把 cookie 上那台匿名車併進會員車，回傳併完的會員車；沒有匿名車就回 null。
 *
 * **登入的當下就要呼叫一次**（見 src/lib/auth 的 signIn event）。
 * 只靠 getOrCreateCart() 合併是不夠的：那條路只有 Server Action 會走，
 * 登入後直接看 /cart 是純讀取，會員車若已經存在（先前登入過就會留下一列，
 * 即使是空的）就把匿名車整台擋在外面 —— 症狀是「登入後購物車空了，
 * 但隨便按一次『直接購買』東西又全部出現」。
 */
export async function claimAnonCart(userId: string): Promise<CartWithItems | null> {
  const anonId = await readAnonId()
  if (!anonId) return null
  return absorbAnonCart(userId, anonId)
}

/** claimAnonCart 的內裡，給已經讀好 anonId 的呼叫端用。 */
export async function absorbAnonCart(
  userId: string,
  anonId: string,
): Promise<CartWithItems | null> {
  const anonCart = await db.cart.findUnique({ where: { anonId }, include: CART_INCLUDE })
  if (!anonCart) return null

  // 空的匿名車沒有搬的價值，順手清掉，免得下次登入又走一遍
  if (anonCart.items.length === 0) {
    await db.cart.delete({ where: { id: anonCart.id } }).catch(() => {})
    return null
  }

  const userCart = await db.cart.findUnique({ where: { userId }, include: CART_INCLUDE })
  return mergeCarts(anonCart, userCart, userId)
}

async function mergeCarts(
  anonCart: CartWithItems,
  userCart: CartWithItems | null,
  userId: string,
): Promise<CartWithItems> {
  // 會員車不存在、或存在但是空的 —— 直接把匿名車認領過來，省一輪搬移。
  // 保留 CartItem 的 id 是有意義的：畫面上那些加減數量與刪除的按鈕握著的就是這組 id，
  // 搬成新的一批會讓使用者按下第一下時吃到「找不到這個品項」。
  if (!userCart || userCart.items.length === 0) {
    await db.$transaction(async (tx) => {
      // userId 在 Cart 上是唯一鍵，空的那列要先讓位
      if (userCart) await tx.cart.delete({ where: { id: userCart.id } })
      await tx.cart.update({
        where: { id: anonCart.id },
        data: { userId, anonId: null },
      })
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
