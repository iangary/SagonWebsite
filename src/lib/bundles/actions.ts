'use server'

import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getOrCreateCart, availableStock } from '@/lib/cart'
import type { CartActionResult } from '@/lib/cart/actions'

const schema = z.object({
  bundleId: z.string().min(1),
  /** 每個組合項目選了哪些規格；數量 2 的項目就給兩個（可以是不同尺寸） */
  selections: z
    .array(
      z.object({
        itemId: z.string().min(1),
        variantIds: z.array(z.string().min(1)).min(1).max(99),
      }),
    )
    .max(50),
})

/**
 * 「加入組合」：一次把組合裡的每個規格放進購物車。
 *
 * 組合不是購物車裡的一個品項 —— 這裡只是逐件加一般規格的捷徑，
 * 折價由購物車／結帳計價時的 matchCartBundles() 自動套用。
 * 所以這裡只需要確保：選的規格真的屬於這個組合、還在架上、庫存夠。
 */
export async function addBundleToCart(
  bundleId: string,
  selections: { itemId: string; variantIds: string[] }[],
): Promise<CartActionResult> {
  const t = await getTranslations('errors')
  const parsed = schema.safeParse({ bundleId, selections })
  if (!parsed.success) return { ok: false, error: t('invalidParams') }

  const bundle = await db.bundle.findUnique({
    where: { id: parsed.data.bundleId },
    select: {
      isActive: true,
      items: {
        select: {
          id: true,
          qty: true,
          productId: true,
          variantId: true,
          product: { select: { status: true } },
        },
      },
    },
  })
  if (!bundle || !bundle.isActive || bundle.items.length === 0) {
    return { ok: false, error: t('bundleUnavailable') }
  }

  // 每個組合項目都要選、而且選的件數要剛好等於組合要求的數量
  const chosen = new Map(parsed.data.selections.map((s) => [s.itemId, s.variantIds]))
  const wanted = new Map<string, { qty: number; productId: string }>()
  for (const item of bundle.items) {
    if (item.product.status !== 'ACTIVE') return { ok: false, error: t('bundleUnavailable') }
    const variantIds = item.variantId
      ? Array.from({ length: item.qty }, () => item.variantId!)
      : chosen.get(item.id)
    if (!variantIds || variantIds.length !== item.qty) {
      return { ok: false, error: t('invalidParams') }
    }
    for (const variantId of variantIds) {
      const entry = wanted.get(variantId) ?? {
        qty: 0,
        productId: item.productId,
      }
      // 同一個規格被兩個項目選到，但兩個項目指的是不同商品 —— 一定是竄改過的請求
      if (entry.productId !== item.productId) return { ok: false, error: t('invalidParams') }
      entry.qty += 1
      wanted.set(variantId, entry)
    }
  }

  const variants = await db.productVariant.findMany({
    where: { id: { in: [...wanted.keys()] } },
    select: {
      id: true,
      productId: true,
      isActive: true,
      stock: true,
      reservedStock: true,
      preorderEnabled: true,
    },
  })
  const byId = new Map(variants.map((v) => [v.id, v]))

  const cart = await getOrCreateCart()
  const inCart = new Map(cart.items.map((i) => [i.variantId, i.qty]))

  const writes: { variantId: string; desired: number; add: number }[] = []
  for (const [variantId, { qty, productId }] of wanted) {
    const variant = byId.get(variantId)
    // 規格必須屬於組合指定的那件商品，不然就能拿 A 商品的組合價買 B 商品
    if (!variant || variant.productId !== productId || !variant.isActive) {
      return { ok: false, error: t('variantUnavailable') }
    }
    const desired = (inCart.get(variantId) ?? 0) + qty
    if (desired > 99) return { ok: false, error: t('invalidQty') }
    if (!variant.preorderEnabled) {
      const available = availableStock(variant)
      if (available <= 0) return { ok: false, error: t('variantSoldOut') }
      if (desired > available)
        return { ok: false, error: t('notEnoughStock', { count: available }) }
    }
    writes.push({ variantId, desired, add: qty })
  }

  // 全部檢查過才一起寫，不會留下「加了一半」的購物車
  await db.$transaction(
    writes.map((w) =>
      db.cartItem.upsert({
        where: {
          cartId_variantId: { cartId: cart.id, variantId: w.variantId },
        },
        update: { qty: w.desired },
        create: { cartId: cart.id, variantId: w.variantId, qty: w.add },
      }),
    ),
  )

  revalidatePath('/cart')
  const agg = await db.cartItem.aggregate({
    where: { cartId: cart.id },
    _sum: { qty: true },
  })
  return { ok: true, count: agg._sum.qty ?? 0 }
}
