'use server'

import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getOrCreateCart, availableStock } from './index'

export type CartActionResult = { ok: true; count: number } | { ok: false; error: string }

/**
 * 錯誤訊息要跟著使用者的語系走。
 *
 * Server Action 由 proxy 的 next-intl middleware 標好語系後才進來，
 * 所以這裡拿得到正確的 locale —— 不能寫死中文，英文站會吐出中文 toast。
 */
function errors() {
  return getTranslations('errors')
}

const addSchema = z.object({
  variantId: z.string().min(1),
  qty: z.number().int().min(1).max(99),
})

async function currentCount(cartId: string): Promise<number> {
  const agg = await db.cartItem.aggregate({ where: { cartId }, _sum: { qty: true } })
  return agg._sum.qty ?? 0
}

export async function addToCart(variantId: string, qty = 1): Promise<CartActionResult> {
  const t = await errors()
  const parsed = addSchema.safeParse({ variantId, qty })
  if (!parsed.success) return { ok: false, error: t('invalidParams') }

  const variant = await db.productVariant.findUnique({
    where: { id: parsed.data.variantId },
    include: { product: { select: { status: true, slug: true } } },
  })

  if (!variant || !variant.isActive || variant.product.status !== 'ACTIVE') {
    return { ok: false, error: t('variantUnavailable') }
  }

  const cart = await getOrCreateCart()
  const existing = cart.items.find((i) => i.variantId === variant.id)
  const desired = (existing?.qty ?? 0) + parsed.data.qty
  const available = availableStock(variant)

  if (available <= 0) return { ok: false, error: t('variantSoldOut') }
  if (desired > available) {
    return { ok: false, error: t('notEnoughStock', { count: available }) }
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
  const t = await errors()
  if (!Number.isInteger(qty) || qty < 0 || qty > 99) {
    return { ok: false, error: t('invalidQty') }
  }

  const cart = await getOrCreateCart()
  const item = cart.items.find((i) => i.id === itemId)
  // 只能動自己車上的東西
  if (!item) return { ok: false, error: t('itemNotFound') }

  if (qty === 0) {
    await db.cartItem.delete({ where: { id: itemId } })
    revalidatePath('/cart')
    return { ok: true, count: await currentCount(cart.id) }
  }

  const available = availableStock(item.variant)
  if (qty > available) {
    return { ok: false, error: t('notEnoughStock', { count: available }) }
  }

  await db.cartItem.update({ where: { id: itemId }, data: { qty } })
  revalidatePath('/cart')
  return { ok: true, count: await currentCount(cart.id) }
}

export async function removeCartItem(itemId: string): Promise<CartActionResult> {
  const cart = await getOrCreateCart()
  if (!cart.items.some((i) => i.id === itemId)) {
    return { ok: false, error: (await errors())('itemNotFound') }
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

  const t = await errors()
  const coupon = await db.coupon.findUnique({ where: { code: trimmed } })
  if (!coupon || !coupon.isActive) return { ok: false, error: t('couponNotFound') }

  const now = new Date()
  if (coupon.startsAt && coupon.startsAt > now) return { ok: false, error: t('couponNotStarted') }
  if (coupon.endsAt && coupon.endsAt < now) return { ok: false, error: t('couponExpired') }

  await db.cart.update({ where: { id: cart.id }, data: { couponCode: trimmed } })
  revalidatePath('/cart')
  return { ok: true }
}
