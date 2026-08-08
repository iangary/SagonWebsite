import 'server-only'
import type { LogisticsSubType, ShippingMethod } from '@prisma/client'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'
import { shopConfig } from '@/lib/shop-config'
import { getOrCreateCart } from '@/lib/cart'
import { generateMerchantTradeNo, type ChoosePayment } from '@/lib/ecpay/aio'
import { calculatePricing, validateCoupon } from './pricing'
import { reserveStock, releaseReservation } from './stock'

export interface CreateOrderInput {
  email: string
  phone: string
  recipientName: string
  recipientPhone: string

  shippingMethod: ShippingMethod
  logisticsSubType: LogisticsSubType

  /** 超商取貨：從綠界電子地圖選回來的門市 */
  cvsStoreId?: string
  cvsStoreName?: string
  cvsAddress?: string
  cvsTelephone?: string

  /** 宅配 */
  addressZip?: string
  addressCity?: string
  addressDistrict?: string
  addressLine?: string

  choosePayment: ChoosePayment
  couponCode?: string
  note?: string

  invoice: {
    isB2B: boolean
    taxId?: string
    companyName?: string
    carrierType: 'NONE' | 'MEMBER' | 'CITIZEN' | 'MOBILE'
    carrierNum?: string
    donation: boolean
    loveCode?: string
  }
}

export type CreateOrderResult =
  | { ok: true; orderId: string; orderNo: string; grandTotal: number }
  | { ok: false; error: string }

/**
 * 從購物車成立訂單。
 *
 * 整段跑在一個交易裡：驗庫存並預扣、建訂單、建付款/物流/發票紀錄、清空購物車。
 * 任何一步失敗就整筆回滾，不會留下「訂單建了但庫存沒扣」這種半套狀態。
 */
export async function createOrderFromCart(input: CreateOrderInput): Promise<CreateOrderResult> {
  const session = await auth()
  const cart = await getOrCreateCart()

  if (cart.items.length === 0) return { ok: false, error: '購物車是空的' }

  // 下單前先確認商品還在架上
  for (const item of cart.items) {
    if (!item.variant.isActive || item.variant.product.status !== 'ACTIVE') {
      return { ok: false, error: `「${item.variant.product.name}」已下架，請從購物車移除` }
    }
  }

  const lines = cart.items.map((item) => ({
    variantId: item.variantId,
    unitPrice: item.variant.price,
    qty: item.qty,
  }))

  const coupon = input.couponCode
    ? await db.coupon.findUnique({ where: { code: input.couponCode.trim().toUpperCase() } })
    : null

  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0)
  if (coupon) {
    const couponError = validateCoupon(coupon, subtotal)
    if (couponError) return { ok: false, error: couponError }

    if (session?.user?.id) {
      const used = await db.couponRedemption.count({
        where: { couponId: coupon.id, userId: session.user.id },
      })
      if (used >= coupon.perUserLimit) {
        return { ok: false, error: '您已達到這張折扣碼的使用次數上限' }
      }
    }
  }

  const pricing = calculatePricing({
    lines,
    shippingMethod: input.shippingMethod,
    shippingFees: shopConfig.shippingFee,
    freeShippingThreshold: shopConfig.freeShippingThreshold,
    coupon,
  })
  if (pricing.couponError) return { ok: false, error: pricing.couponError }

  const orderNo = generateMerchantTradeNo()
  const expiresAt = new Date(Date.now() + shopConfig.stockReservationMinutes * 60 * 1000)

  try {
    const order = await db.$transaction(async (tx) => {
      // 先預扣庫存。任何一項失敗就把先前扣掉的還回去再中止整筆交易。
      const reserved: { variantId: string; qty: number }[] = []
      for (const item of cart.items) {
        const ok = await reserveStock(tx, item.variantId, item.qty)
        if (!ok) {
          for (const r of reserved) await releaseReservation(tx, r.variantId, r.qty)
          throw new OutOfStockError(item.variant.product.name, item.variant.name)
        }
        reserved.push({ variantId: item.variantId, qty: item.qty })
      }

      const created = await tx.order.create({
        data: {
          orderNo,
          userId: session?.user?.id ?? null,
          email: input.email.toLowerCase(),
          phone: input.phone,
          status: 'PENDING_PAYMENT',
          subtotal: pricing.subtotal,
          discountTotal: pricing.discountTotal,
          shippingFee: pricing.shippingFee,
          grandTotal: pricing.grandTotal,
          couponId: coupon?.id ?? null,
          shippingMethod: input.shippingMethod,
          note: input.note ?? null,
          recipientName: input.recipientName,
          recipientPhone: input.recipientPhone,
          addressZip: input.addressZip ?? null,
          addressCity: input.addressCity ?? null,
          addressLine:
            input.shippingMethod === 'HOME'
              ? [input.addressDistrict, input.addressLine].filter(Boolean).join('')
              : null,

          items: {
            create: cart.items.map((item) => ({
              variantId: item.variantId,
              productName: item.variant.product.name,
              variantName: item.variant.name,
              sku: item.variant.sku,
              imageUrl: item.variant.product.images[0]?.url ?? null,
              unitPrice: item.variant.price,
              qty: item.qty,
              lineTotal: item.variant.price * item.qty,
            })),
          },

          reservations: {
            create: cart.items.map((item) => ({
              variantId: item.variantId,
              qty: item.qty,
              expiresAt,
            })),
          },

          payment: {
            create: {
              merchantTradeNo: orderNo,
              choosePayment: input.choosePayment,
              amount: pricing.grandTotal,
              status: 'PENDING',
            },
          },

          shipment: {
            create: {
              logisticsType: input.shippingMethod === 'CVS' ? 'CVS' : 'HOME',
              logisticsSubType: input.logisticsSubType,
              cvsStoreId: input.cvsStoreId ?? null,
              cvsStoreName: input.cvsStoreName ?? null,
              cvsAddress: input.cvsAddress ?? null,
              cvsTelephone: input.cvsTelephone ?? null,
              receiverName: input.recipientName,
              receiverCell: input.recipientPhone,
              receiverZip: input.addressZip ?? null,
              receiverAddress:
                input.shippingMethod === 'HOME'
                  ? [input.addressCity, input.addressDistrict, input.addressLine]
                      .filter(Boolean)
                      .join('')
                  : null,
              status: 'PENDING',
              goodsAmount: pricing.grandTotal,
            },
          },

          invoice: {
            create: {
              isB2B: input.invoice.isB2B,
              taxId: input.invoice.taxId ?? null,
              companyName: input.invoice.companyName ?? null,
              carrierType: input.invoice.carrierType,
              carrierNum: input.invoice.carrierNum ?? null,
              donation: input.invoice.donation,
              loveCode: input.invoice.loveCode ?? null,
              amount: pricing.grandTotal,
              status: 'PENDING',
            },
          },
        },
      })

      if (coupon) {
        // 條件式遞增：usageLimit 已滿時 0 rows affected，代表剛好被別人搶走最後一次
        const claimed = await tx.$executeRaw`
          UPDATE coupons
             SET "usedCount" = "usedCount" + 1
           WHERE id = ${coupon.id}
             AND ("usageLimit" IS NULL OR "usedCount" < "usageLimit")
        `
        if (claimed !== 1) throw new CouponExhaustedError()

        await tx.couponRedemption.create({
          data: {
            couponId: coupon.id,
            userId: session?.user?.id ?? null,
            orderId: created.id,
          },
        })
      }

      // 訂單成立就清空購物車，避免使用者重整結帳頁又下一次
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } })
      await tx.cart.update({ where: { id: cart.id }, data: { couponCode: null } })

      return created
    })

    return {
      ok: true,
      orderId: order.id,
      orderNo: order.orderNo,
      grandTotal: order.grandTotal,
    }
  } catch (error) {
    if (error instanceof OutOfStockError) {
      return { ok: false, error: `「${error.productName} ${error.variantName}」庫存不足，請調整數量` }
    }
    if (error instanceof CouponExhaustedError) {
      return { ok: false, error: '折扣碼剛好被兌換完了，請移除後再試一次' }
    }
    throw error
  }
}

class OutOfStockError extends Error {
  constructor(
    readonly productName: string,
    readonly variantName: string,
  ) {
    super('OUT_OF_STOCK')
  }
}

class CouponExhaustedError extends Error {
  constructor() {
    super('COUPON_EXHAUSTED')
  }
}
