import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/queue', async () => (await import('./mocks')).queueMockModule())

import { db } from '@/lib/db'
import { handlePaymentInfo, handlePaymentReturn } from '@/lib/orders/payment'
import { changePaymentMethod, convertToCod, markCodCollected } from '@/lib/orders/payment-method'
import { savePaymentSettings, DEFAULT_PAYMENT_SETTINGS } from '@/lib/shop-settings'
import { releaseExpiredReservations } from '@/lib/orders/stock'
import { createTestOrder, createTestUser, reloadOrder } from '../factories'
import { enqueueMock } from './mocks'
import { signedCvsPaymentInfoParams, signedPaymentReturnParams } from './helpers/ecpay'

/**
 * 「待付款期間改用其他付款方式」與「貨到付款」的整合測試。
 *
 * 這兩件事的難點都不在畫面，而在錢與庫存的邊界：
 *   - 舊的超商代碼在綠界端沒有作廢 API，換了付款方式之後仍然繳得成功
 *   - 貨到付款沒有付款通知會來，庫存預扣如果留著就會被逾期排程整張取消
 * 所以這裡跑的是真資料庫與真交易。
 */

function jobs(): Array<[string, Record<string, unknown>]> {
  return enqueueMock.mock.calls as unknown as Array<[string, Record<string, unknown>]>
}

async function freshVariant(id: string) {
  return db.productVariant.findUniqueOrThrow({ where: { id } })
}

async function enableCod() {
  const admin = await createTestUser({ role: 'ADMIN' })
  await savePaymentSettings(
    { ...DEFAULT_PAYMENT_SETTINGS, codEnabled: true, codFee: 0 },
    admin.id,
  )
}

beforeEach(() => {
  enqueueMock.mockClear()
})

describe('changePaymentMethod — 改用其他付款方式', () => {
  it('產生新的一筆付款（新 MerchantTradeNo），舊那筆標記作廢但留著', async () => {
    const { order } = await createTestOrder({ choosePayment: 'CVS' })
    // 先取號，模擬「已經拿到繳費代碼才想改」
    await handlePaymentInfo(signedCvsPaymentInfoParams(order))

    const result = await changePaymentMethod({ orderId: order.id, choice: 'Credit' })
    expect(result).toEqual({
      ok: true,
      kind: 'ecpay',
      redirectTo: `/api/ecpay/payment/checkout/${order.orderNo}`,
    })

    const payments = await db.payment.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
    })
    expect(payments).toHaveLength(2)

    const [old, fresh] = payments
    expect(old.choosePayment).toBe('CVS')
    expect(old.status).toBe('EXPIRED')
    expect(old.supersededAt).not.toBeNull()
    // 舊的繳費代碼必須留著，逾期入帳時要靠它找回訂單
    expect(old.paymentNo).not.toBeNull()

    expect(fresh.choosePayment).toBe('Credit')
    expect(fresh.status).toBe('PENDING')
    expect(fresh.supersededAt).toBeNull()
    // 綠界的 MerchantTradeNo 不可重複，新的那筆一定是新號
    expect(fresh.merchantTradeNo).not.toBe(old.merchantTradeNo)
  })

  it('庫存預扣期限跟著新付款方式調整（信用卡 → 超商代碼變成好幾天）', async () => {
    const { order } = await createTestOrder({ choosePayment: 'Credit' })

    const before = Date.now()
    await changePaymentMethod({ orderId: order.id, choice: 'CVS' })

    const reservation = await db.stockReservation.findFirstOrThrow({
      where: { orderId: order.id },
    })
    const minutes = (reservation.expiresAt.getTime() - before) / 60_000
    // 預設 cvsExpireDays = 2
    expect(minutes).toBeGreaterThan(2 * 1440 - 2)
    expect(minutes).toBeLessThan(2 * 1440 + 2)
  })

  it('已付款的訂單不給改', async () => {
    const { order } = await createTestOrder()
    await handlePaymentReturn(signedPaymentReturnParams(order))

    const result = await changePaymentMethod({ orderId: order.id, choice: 'ATM' })
    expect(result).toEqual({ ok: false, error: '這張訂單已經不是待付款狀態，無法更改付款方式' })
  })

  it('後台沒開放的付款方式擋下來（前端送什麼都不算）', async () => {
    const admin = await createTestUser({ role: 'ADMIN' })
    await savePaymentSettings(
      { ...DEFAULT_PAYMENT_SETTINGS, methods: { ...DEFAULT_PAYMENT_SETTINGS.methods, ATM: false } },
      admin.id,
    )

    const { order } = await createTestOrder({ choosePayment: 'CVS' })
    const result = await changePaymentMethod({ orderId: order.id, choice: 'ATM' })
    expect(result).toEqual({ ok: false, error: '這個付款方式目前沒有開放' })
  })

  it('改成貨到付款：直接進備貨、預扣轉實扣、派出建物流單', async () => {
    await enableCod()
    const { order, variant } = await createTestOrder({ choosePayment: 'CVS', qty: 2 })

    const result = await changePaymentMethod({ orderId: order.id, choice: 'COD' })
    expect(result).toEqual({ ok: true, kind: 'cod' })

    const fresh = await reloadOrder(order.id)
    expect(fresh.status).toBe('PROCESSING')
    expect(fresh.payment?.provider).toBe('COD')
    expect(fresh.payment?.status).toBe('AWAITING_COLLECTION')
    expect(fresh.shipment?.isCollection).toBe(true)

    // 沒有付款通知會來，預扣必須當場轉實扣，否則逾期排程會取消整張訂單
    expect(fresh.reservations[0]?.committedAt).not.toBeNull()
    const v = await freshVariant(variant.id)
    expect(v.stock).toBe(8)
    expect(v.reservedStock).toBe(0)

    expect(jobs()).toEqual([
      ['create-shipment', { orderId: order.id }],
      ['send-email', { template: 'cod-confirmed', orderId: order.id }],
    ])
  })

  it('後台沒開貨到付款時擋下來', async () => {
    const { order } = await createTestOrder({ choosePayment: 'CVS' })
    const result = await changePaymentMethod({ orderId: order.id, choice: 'COD' })
    expect(result).toEqual({ ok: false, error: '這張訂單不適用貨到付款' })
  })
})

describe('舊代碼在改了付款方式之後才被繳費', () => {
  it('訂單還在待付款：照樣入帳，另一組代碼一併作廢', async () => {
    const { order, variant } = await createTestOrder({ choosePayment: 'CVS', qty: 2 })
    await handlePaymentInfo(signedCvsPaymentInfoParams(order))
    const oldPayment = await db.payment.findFirstOrThrow({ where: { orderId: order.id } })

    await changePaymentMethod({ orderId: order.id, choice: 'ATM' })
    enqueueMock.mockClear()

    // 消費者拿舊的超商代碼去繳費 —— 綠界沒有作廢代碼的 API，它還是有效的
    await handlePaymentReturn(
      signedPaymentReturnParams(
        { grandTotal: order.grandTotal, payment: { merchantTradeNo: oldPayment.merchantTradeNo } },
        { PaymentType: 'CVS' },
      ),
    )

    const fresh = await reloadOrder(order.id)
    expect(fresh.status).toBe('PAID')
    // 收到錢的那筆重新變成生效的付款紀錄
    expect(fresh.payment?.id).toBe(oldPayment.id)
    expect(fresh.payment?.status).toBe('PAID')
    expect(fresh.payment?.supersededAt).toBeNull()

    // 另一組（ATM）作廢，避免消費者又去轉一次帳
    const other = await db.payment.findFirstOrThrow({
      where: { orderId: order.id, id: { not: oldPayment.id } },
    })
    expect(other.status).toBe('EXPIRED')

    expect(fresh.reservations[0]?.committedAt).not.toBeNull()
    expect((await freshVariant(variant.id)).stock).toBe(8)

    // 沒有留下需要人工退款的紀錄 —— 這是正常付款，不是重複付款
    expect(await db.refundRequest.count({ where: { orderId: order.id } })).toBe(0)
  })

  it('訂單已用新方式付過款：判定為重複付款並自動開一張退款單', async () => {
    const { order } = await createTestOrder({ choosePayment: 'CVS' })
    await handlePaymentInfo(signedCvsPaymentInfoParams(order))
    const oldPayment = await db.payment.findFirstOrThrow({ where: { orderId: order.id } })

    await changePaymentMethod({ orderId: order.id, choice: 'Credit' })
    const newPayment = await db.payment.findFirstOrThrow({
      where: { orderId: order.id, supersededAt: null },
    })

    // 先用新的信用卡付款成功
    await handlePaymentReturn(
      signedPaymentReturnParams({
        grandTotal: order.grandTotal,
        payment: { merchantTradeNo: newPayment.merchantTradeNo },
      }),
    )
    // 然後舊的超商代碼也被繳了
    await handlePaymentReturn(
      signedPaymentReturnParams(
        { grandTotal: order.grandTotal, payment: { merchantTradeNo: oldPayment.merchantTradeNo } },
        { PaymentType: 'CVS' },
      ),
    )

    const paid = await db.payment.findMany({ where: { orderId: order.id, status: 'PAID' } })
    expect(paid).toHaveLength(2)

    const stale = await db.payment.findUniqueOrThrow({ where: { id: oldPayment.id } })
    expect(stale.failReason).toContain('重複付款')

    const refund = await db.refundRequest.findFirstOrThrow({ where: { orderId: order.id } })
    expect(refund.status).toBe('REQUESTED')
    expect(refund.paymentId).toBe(oldPayment.id)
    expect(refund.amount).toBe(order.grandTotal)
    expect(refund.reason).toContain('【系統偵測】')
  })

  it('重複的回拋不會開出第二張退款單', async () => {
    const { order } = await createTestOrder({ status: 'CANCELLED', withReservations: false })
    const payment = await db.payment.findFirstOrThrow({ where: { orderId: order.id } })

    const params = signedPaymentReturnParams({
      grandTotal: order.grandTotal,
      payment: { merchantTradeNo: payment.merchantTradeNo },
    })
    await handlePaymentReturn(params)
    await handlePaymentReturn(params)

    expect(await db.refundRequest.count({ where: { orderId: order.id } })).toBe(1)
  })
})

describe('貨到付款的收款', () => {
  it('物流回報已取貨之前都是「尚未收款」，逾期排程也不會動它', async () => {
    await enableCod()
    const { order } = await createTestOrder({
      choosePayment: 'CVS',
      reservationExpiresAt: new Date(Date.now() - 60_000),
    })
    await convertToCod(order.id)

    // 預扣已經轉實扣，逾期排程掃不到它 —— 貨到付款的訂單不該被當成「沒付款」取消
    const result = await releaseExpiredReservations()
    expect(result.ordersCancelled).toBe(0)

    const fresh = await reloadOrder(order.id)
    expect(fresh.status).toBe('PROCESSING')
    expect(fresh.payment?.status).toBe('AWAITING_COLLECTION')
    expect(fresh.paidAt).toBeNull()
  })

  it('markCodCollected：標記收款並寫入付款時間，重複呼叫回 false', async () => {
    await enableCod()
    const { order } = await createTestOrder({ choosePayment: 'CVS' })
    await convertToCod(order.id)

    expect(await markCodCollected(order.id, { note: '門市已收款' })).toBe(true)

    const fresh = await reloadOrder(order.id)
    expect(fresh.payment?.status).toBe('PAID')
    expect(fresh.payment?.paidAt).not.toBeNull()
    expect(fresh.paidAt).not.toBeNull()

    expect(await markCodCollected(order.id)).toBe(false)
  })

  it('線上付款的訂單沒有貨到付款紀錄可標記', async () => {
    const { order } = await createTestOrder({ choosePayment: 'Credit' })
    expect(await markCodCollected(order.id)).toBe(false)
  })
})
