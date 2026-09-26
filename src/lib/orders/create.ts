import 'server-only'
import type { LogisticsSubType, ShippingMethod } from '@prisma/client'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'
import { getOrCreateCart } from '@/lib/cart'
import { enqueue } from '@/lib/queue'
import { generateMerchantTradeNo } from '@/lib/ecpay/aio'
import {
  getPaymentSettings,
  getShippingSettings,
  holdMinutesFor,
  isBankTransferAvailable,
  isCodAvailable,
  shippingFeesOf,
  type PaymentChoice,
} from '@/lib/shop-settings'
import { formatTransferDeadline } from './bank-transfer'
import { calculatePricing, validateCoupon } from './pricing'
import { commitOrderReservations, reserveStock, releaseReservation } from './stock'

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

  choosePayment: PaymentChoice
  couponCode?: string
  note?: string

  /** 紙本統一發票的抬頭資訊。發票由人工開立、隨包裹寄出。 */
  invoice: {
    isB2B: boolean
    taxId?: string
    companyName?: string
  }
}

export type CreateOrderResult =
  | {
      ok: true
      orderId: string
      orderNo: string
      grandTotal: number
      /** 貨到付款不必去綠界，前台要導去訂單結果頁而不是收銀台 */
      isCod: boolean
      /** 不經綠界的付款方式（貨到付款、銀行匯款）沒有收銀台可以去 */
      needsGateway: boolean
    }
  | { ok: false; error: string }

/**
 * 從購物車成立訂單。
 *
 * **只有會員能下單。** 前台在購物車與結帳頁就會把訪客導去註冊，這裡是最後一道
 * 關卡 —— 直接打 Server Action，或填單途中 session 過期，都要在這裡被擋下。
 *
 * 整段跑在一個交易裡：驗庫存並預扣、建訂單、建付款/物流/發票紀錄、清空購物車。
 * 任何一步失敗就整筆回滾，不會留下「訂單建了但庫存沒扣」這種半套狀態。
 */
export async function createOrderFromCart(input: CreateOrderInput): Promise<CreateOrderResult> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return { ok: false, error: '請先註冊或登入會員再結帳' }

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

    const used = await db.couponRedemption.count({
      where: { couponId: coupon.id, userId },
    })
    if (used >= coupon.perUserLimit) {
      return { ok: false, error: '您已達到這張折扣碼的使用次數上限' }
    }
  }

  const [settings, shipping] = await Promise.all([getPaymentSettings(), getShippingSettings()])
  const isCod = input.choosePayment === 'COD'
  // 匯款到公司帳戶：訂單一樣要等錢進來才出貨，但錢不經綠界，
  // 帳號在下單當下就已經知道，所以不必去收銀台、也不會有取號通知。
  const isBank = input.choosePayment === 'BANK'

  const pricing = calculatePricing({
    lines,
    shippingMethod: input.shippingMethod,
    shippingFees: shippingFeesOf(shipping),
    freeShippingThreshold: shipping.freeShippingThreshold,
    coupon,
    codFee: isCod ? settings.codFee : 0,
  })
  if (pricing.couponError) return { ok: false, error: pricing.couponError }

  // 付款方式的開關是後台設定，前端送什麼都要在這裡重驗一次
  if (input.choosePayment === 'COD') {
    if (!isCodAvailable(settings, input.shippingMethod, pricing.grandTotal)) {
      return { ok: false, error: '這筆訂單不適用貨到付款，請改選其他付款方式' }
    }
  } else if (input.choosePayment === 'BANK') {
    if (!isBankTransferAvailable(settings)) {
      return { ok: false, error: '匯款付款目前沒有開放，請改選其他付款方式' }
    }
  } else if (!settings.prepayEnabled || !settings.methods[input.choosePayment]) {
    return { ok: false, error: '這個付款方式目前沒有開放' }
  }

  const orderNo = generateMerchantTradeNo()
  // 預扣有效期必須對齊「消費者實際拿到的付款期限」：
  // 超商代碼可以是好幾天，若照 30 分鐘就取消訂單，
  // 消費者隔天繳費會變成「錢收到了、訂單卻已取消」。
  const reservationMinutes = holdMinutesFor(input.choosePayment, settings)
  const expiresAt = new Date(Date.now() + reservationMinutes * 60 * 1000)

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
          userId,
          email: input.email.toLowerCase(),
          phone: input.phone,
          // 貨到付款不等錢進來，直接進備貨；線上付款要等綠界的通知
          status: isCod ? 'PROCESSING' : 'PENDING_PAYMENT',
          subtotal: pricing.subtotal,
          discountTotal: pricing.discountTotal,
          shippingFee: pricing.shippingFee,
          codFee: pricing.codFee,
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

          payments: {
            create: {
              // 貨到付款與匯款都不經綠界，但 merchantTradeNo 是唯一鍵，還是給一組好對帳
              merchantTradeNo: isCod
                ? generateMerchantTradeNo('CD')
                : isBank
                  ? generateMerchantTradeNo('BK')
                  : orderNo,
              provider: isCod ? 'COD' : isBank ? 'BANK' : 'ECPAY',
              choosePayment: input.choosePayment,
              amount: pricing.grandTotal,
              // 匯款沒有取號這一步，帳號當下就給了，直接是「等客人轉帳」
              status: isCod ? 'AWAITING_COLLECTION' : isBank ? 'AWAITING_TRANSFER' : 'PENDING',
              // 期限與庫存預扣同一個時間點，畫面才不會說「還能匯」卻已被排程取消
              expireDate: isBank ? formatTransferDeadline(expiresAt) : null,
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
              // 貨到付款：請超商／黑貓代收貨款
              isCollection: isCod,
              goodsAmount: pricing.grandTotal,
            },
          },

          // 紙本統一發票由人工開立隨包裹寄出，這裡只先建紀錄
          invoice: {
            create: {
              isB2B: input.invoice.isB2B,
              taxId: input.invoice.taxId ?? null,
              companyName: input.invoice.companyName ?? null,
              amount: pricing.grandTotal,
              status: 'PENDING',
            },
          },

          // 綠界電子收據，付款成功後由 worker 開立
          receipt: {
            create: {
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
            userId,
            orderId: created.id,
          },
        })
      }

      // 貨到付款沒有付款通知會來，預扣要當場轉實扣 ——
      // 留著預扣會被逾期排程當成「沒付款」而取消整張訂單。
      if (isCod) await commitOrderReservations(tx, created.id)

      // 訂單成立就清空購物車，避免使用者重整結帳頁又下一次
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } })
      await tx.cart.update({ where: { id: cart.id }, data: { couponCode: null } })

      return created
    })

    // 匯款：帳號與期限都要主動寄一封信，客人關掉訂單頁就找不到帳號了
    if (isBank) {
      await enqueue('send-email', { template: 'bank-transfer-info', orderId: order.id })
    }

    // 貨到付款直接進備貨：建物流單（帶代收）與通知信都在這裡發車
    if (isCod) {
      await enqueue('create-shipment', { orderId: order.id })
      await enqueue('send-email', {
        template: 'cod-confirmed',
        orderId: order.id,
      })
    }

    return {
      ok: true,
      orderId: order.id,
      orderNo: order.orderNo,
      grandTotal: order.grandTotal,
      isCod,
      needsGateway: !isCod && !isBank,
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
