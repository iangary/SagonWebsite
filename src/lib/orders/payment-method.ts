import 'server-only'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { enqueue } from '@/lib/queue'
import { generateMerchantTradeNo } from '@/lib/ecpay/aio'
import {
  getPaymentSettings,
  holdMinutesFor,
  isBankTransferAvailable,
  isCodAvailable,
  type PaymentChoice,
  type PaymentSettings,
} from '@/lib/shop-settings'
import { formatTransferDeadline } from './bank-transfer'
import { commitOrderReservations } from './stock'

/**
 * 待付款訂單改用其他付款方式，以及貨到付款訂單的生命週期。
 *
 * 為什麼不能「改一改原本那筆 Payment 就好」：
 *   1. 綠界的 MerchantTradeNo 全站唯一且不可重送，換付款方式必須換一組新的
 *   2. 舊的超商代碼／虛擬帳號沒有作廢 API，在期限內一直有效 ——
 *      消費者真的拿舊代碼去繳費時，回拋只帶舊的 MerchantTradeNo，
 *      我們必須查得到它屬於哪張訂單（見 payment.ts 的 applySuccessfulPayment）
 * 所以是「新增一筆、把舊的標記作廢」，不是「改一筆」。
 */

export type ChangePaymentResult =
  | { ok: true; kind: 'ecpay'; redirectTo: string }
  | { ok: true; kind: 'cod' }
  /** 匯款：沒有地方可以導，帳號就印在訂單頁上，重新整理就看到了 */
  | { ok: true; kind: 'bank' }
  | { ok: false; error: string }

export async function changePaymentMethod(input: {
  orderId: string
  choice: PaymentChoice
}): Promise<ChangePaymentResult> {
  const settings = await getPaymentSettings()

  const order = await db.order.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      orderNo: true,
      status: true,
      grandTotal: true,
      shippingMethod: true,
      payments: { orderBy: { createdAt: 'desc' } },
    },
  })
  if (!order) return { ok: false, error: '找不到訂單' }

  if (order.status !== 'PENDING_PAYMENT') {
    return { ok: false, error: '這張訂單已經不是待付款狀態，無法更改付款方式' }
  }
  if (order.payments.some((p) => p.status === 'PAID')) {
    return { ok: false, error: '這張訂單已經收到款項，無法更改付款方式' }
  }

  if (input.choice === 'COD') {
    if (!isCodAvailable(settings, order.shippingMethod, order.grandTotal)) {
      return { ok: false, error: '這張訂單不適用貨到付款' }
    }
    await convertToCod(order.id)
    return { ok: true, kind: 'cod' }
  }

  const isBank = input.choice === 'BANK'
  if (input.choice === 'BANK') {
    if (!isBankTransferAvailable(settings)) {
      return { ok: false, error: '匯款付款目前沒有開放' }
    }
  } else if (!settings.prepayEnabled || !settings.methods[input.choice]) {
    return { ok: false, error: '這個付款方式目前沒有開放' }
  }

  const holdMinutes = holdMinutesFor(input.choice, settings)
  const expiresAt = new Date(Date.now() + holdMinutes * 60 * 1000)

  await db.$transaction(async (tx) => {
    // 交易內重讀，擋住「按了兩次改付款方式」與「剛好付款通知進來」
    const fresh = await tx.order.findUnique({
      where: { id: order.id },
      select: { status: true },
    })
    if (fresh?.status !== 'PENDING_PAYMENT') {
      throw new PaymentMethodConflict('訂單狀態剛才變動了，請重新整理頁面')
    }

    // 舊的代碼／帳號作廢。狀態設 EXPIRED 讓後台一眼看出它已經不該被繳費，
    // 但列仍留著供逾期入帳比對。
    await tx.payment.updateMany({
      where: {
        orderId: order.id,
        supersededAt: null,
        status: { in: ['PENDING', 'AWAITING_TRANSFER', 'FAILED', 'AWAITING_COLLECTION'] },
      },
      data: { status: 'EXPIRED', supersededAt: new Date() },
    })

    await tx.payment.create({
      data: {
        orderId: order.id,
        provider: isBank ? 'BANK' : 'ECPAY',
        merchantTradeNo: generateMerchantTradeNo(isBank ? 'BK' : 'SG'),
        choosePayment: input.choice,
        amount: order.grandTotal,
        // 匯款沒有取號這一步（帳號是固定的那組），直接是「等客人轉帳」
        status: isBank ? 'AWAITING_TRANSFER' : 'PENDING',
        expireDate: isBank ? formatTransferDeadline(expiresAt) : null,
      },
    })

    // 付款期限變了，庫存預扣也要跟著變 —— 否則會出現
    // 「代碼有效期 2 天、庫存 30 分鐘後就被排程釋放」
    await extendReservations(tx, order.id, expiresAt)

    // 貨到付款改回線上付款：把代收取消掉
    await tx.shipment.updateMany({
      where: { orderId: order.id },
      data: { isCollection: false },
    })
  })

  if (isBank) {
    // 帳號與期限主動寄一封信，客人關掉訂單頁就找不到帳號了
    await enqueue('send-email', { template: 'bank-transfer-info', orderId: order.id })
    return { ok: true, kind: 'bank' }
  }

  return {
    ok: true,
    kind: 'ecpay',
    redirectTo: `/api/ecpay/payment/checkout/${order.orderNo}`,
  }
}

/**
 * 把一張待付款訂單轉成貨到付款：不再等錢進來，直接進備貨流程。
 *
 * 庫存的預扣要在這裡就轉成實扣 —— 沒有付款通知會來，
 * 留著預扣會被逾期排程當成「沒付款」而取消整張訂單。
 */
export async function convertToCod(orderId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, grandTotal: true },
    })
    if (!order || order.status !== 'PENDING_PAYMENT') {
      throw new PaymentMethodConflict('只有待付款的訂單可以改成貨到付款')
    }

    await tx.payment.updateMany({
      where: { orderId, supersededAt: null, status: { not: 'PAID' } },
      data: { status: 'EXPIRED', supersededAt: new Date() },
    })

    await tx.payment.create({
      data: {
        orderId,
        provider: 'COD',
        // 貨到付款不經綠界，但 merchantTradeNo 是唯一鍵，還是給一組好對帳
        merchantTradeNo: generateMerchantTradeNo('CD'),
        choosePayment: 'COD',
        amount: order.grandTotal,
        status: 'AWAITING_COLLECTION',
      },
    })

    await tx.shipment.updateMany({
      where: { orderId },
      data: { isCollection: true, goodsAmount: order.grandTotal },
    })

    await tx.order.update({ where: { id: orderId }, data: { status: 'PROCESSING' } })
    await commitOrderReservations(tx, orderId)
  })

  await enqueue('create-shipment', { orderId })
  await enqueue('send-email', { template: 'cod-confirmed', orderId })
}

/**
 * 貨到付款的錢收到了。
 *
 * 兩個觸發點：超商回拋「已取貨」／黑貓貨態轉已配達（代表消費者付了錢才拿到貨），
 * 以及後台的手動標記（對帳對出來、或現場狀況特殊時）。
 */
export async function markCodCollected(
  orderId: string,
  options: { note?: string } = {},
): Promise<boolean> {
  const payment = await db.payment.findFirst({
    where: { orderId, provider: 'COD', supersededAt: null },
    orderBy: { createdAt: 'desc' },
  })
  if (!payment || payment.status === 'PAID') return false

  const now = new Date()
  await db.$transaction([
    db.payment.update({
      where: { id: payment.id },
      data: {
        status: 'PAID',
        paidAt: now,
        failReason: options.note ?? null,
      },
    }),
    db.order.update({ where: { id: orderId }, data: { paidAt: now } }),
  ])
  return true
}

/** 把訂單的庫存預扣期限延長／縮短到新的付款期限。 */
async function extendReservations(
  tx: Prisma.TransactionClient,
  orderId: string,
  expiresAt: Date,
): Promise<void> {
  await tx.stockReservation.updateMany({
    where: { orderId, releasedAt: null, committedAt: null },
    data: { expiresAt },
  })
}

export class PaymentMethodConflict extends Error {}

/** 結帳頁與訂單頁共用：這個付款方式現在能不能選。 */
export function canOfferChoice(
  choice: PaymentChoice,
  settings: PaymentSettings,
  shippingMethod: 'CVS' | 'HOME',
  grandTotal: number,
): boolean {
  if (choice === 'COD') return isCodAvailable(settings, shippingMethod, grandTotal)
  if (choice === 'BANK') return isBankTransferAvailable(settings)
  return settings.prepayEnabled && settings.methods[choice]
}
