'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getOrCreateCart, availableStock } from './index'

export type CartActionResult = { ok: true; count: number } | { ok: false; error: string }

const addSchema = z.object({
  variantId: z.string().min(1),
  qty: z.number().int().min(1).max(99),
})

async function currentCount(cartId: string): Promise<number> {
  const agg = await db.cartItem.aggregate({ where: { cartId }, _sum: { qty: true } })
  return agg._sum.qty ?? 0
}

export async function addToCart(variantId: string, qty = 1): Promise<CartActionResult> {
  const parsed = addSchema.safeParse({ variantId, qty })
  if (!parsed.success) return { ok: false, error: '參數不正確' }

  const variant = await db.productVariant.findUnique({
    where: { id: parsed.data.variantId },
    include: { product: { select: { status: true, slug: true } } },
  })

  if (!variant || !variant.isActive || variant.product.status !== 'ACTIVE') {
    return { ok: false, error: '這個規格已下架' }
  }

  const cart = await getOrCreateCart()
  const existing = cart.items.find((i) => i.variantId === variant.id)
  const desired = (existing?.qty ?? 0) + parsed.data.qty
  const available = availableStock(variant)

  if (available <= 0) return { ok: false, error: '這個規格已售完' }
  if (desired > available) {
    return { ok: false, error: `庫存不足，這個規格最多只能購買 ${available} 件` }
  }

  await db.cartItem.upsert({
    where: { cartId_variantId: { cartId: cart.id, variantId: variant.id } },
    update: { qty: desired },
    create: { cartId: cart.id, variantId: variant.id, qty: parsed.data.qty },
  })

  revalidatePath('/cart')
  return { ok: true, count: await currentCount(cart.id) }
}

export async function updateCartItemQty(itemId: string, qty: number): Promise<CartActionResult> {
  if (!Number.isInteger(qty) || qty < 0 || qty > 99) {
    return { ok: false, error: '數量不正確' }
  }

  const cart = await getOrCreateCart()
  const item = cart.items.find((i) => i.id === itemId)
  // 只能動自己車上的東西
  if (!item) return { ok: false, error: '找不到這個項目' }

  if (qty === 0) {
    await db.cartItem.delete({ where: { id: itemId } })
    revalidatePath('/cart')
    return { ok: true, count: await currentCount(cart.id) }
  }

  const available = availableStock(item.variant)
  if (qty > available) {
    return { ok: false, error: `庫存不足，這個規格最多只能購買 ${available} 件` }
  }

  await db.cartItem.update({ where: { id: itemId }, data: { qty } })
  revalidatePath('/cart')
  return { ok: true, count: await currentCount(cart.id) }
}

export async function removeCartItem(itemId: string): Promise<CartActionResult> {
  const cart = await getOrCreateCart()
  if (!cart.items.some((i) => i.id === itemId)) {
    return { ok: false, error: '找不到這個項目' }
  }

  await db.cartItem.delete({ where: { id: itemId } })
  revalidatePath('/cart')
  return { ok: true, count: await currentCount(cart.id) }
}

export async function applyCoupon(code: string): Promise<{ ok: boolean; error?: string }> {
  const cart = await getOrCreateCart()
  const trimmed = code.trim().toUpperCase()

  if (!trimmed) {
    await db.cart.update({ where: { id: cart.id }, data: { couponCode: null } })
    revalidatePath('/cart')
    return { ok: true }
  }

  const coupon = await db.coupon.findUnique({ where: { code: trimmed } })
  if (!coupon || !coupon.isActive) return { ok: false, error: '折扣碼不存在或已停用' }

  const now = new Date()
  if (coupon.startsAt && coupon.startsAt > now) return { ok: false, error: '折扣碼尚未開始' }
  if (coupon.endsAt && coupon.endsAt < now) return { ok: false, error: '折扣碼已過期' }

  await db.cart.update({ where: { id: cart.id }, data: { couponCode: trimmed } })
  revalidatePath('/cart')
  return { ok: true }
}
