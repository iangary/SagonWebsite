import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/queue', async () => (await import('./mocks')).queueMockModule())

import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { handlePaymentInfo, handlePaymentReturn, parseEcpayDate } from '@/lib/orders/payment'
import { releaseExpiredReservations } from '@/lib/orders/stock'
import { createTestOrder, reloadOrder } from '../factories'
import { enqueueMock } from './mocks'
import { signedCvsPaymentInfoParams, signedPaymentInfoParams, signedPaymentReturnParams } from './helpers/ecpay'

/**
 * 綠界付款結果通知（ReturnURL / PaymentInfoURL）的整合測試。
 *
 * 只 mock @/lib/queue（後續工作全靠 enqueue），資料庫走真的 ——
 * 重複回拋與「到期 vs 付款」競態必須在真交易上才測得出來。
 */

async function freshVariant(id: string) {
  return db.productVariant.findUniqueOrThrow({ where: { id } })
}

/** enqueueMock 的實作簽章是空參數，這裡把 calls 轉回實際呼叫形狀 */
function jobs(): Array<[string, Record<string, unknown>]> {
  return enqueueMock.mock.calls as unknown as Array<[string, Record<string, unknown>]>
}

/** 綠界日期是台北時間（+08:00），換算成 UTC Date 供比對 */
function ecpayDateToUtc(raw: string): Date {
  const [date, time] = raw.split(' ')
  return new Date(`${date.replace(/\//g, '-')}T${time}+08:00`)
}

beforeEach(() => {
  enqueueMock.mockClear()
})

describe('handlePaymentReturn — 成功路徑', () => {
  it('付款成功：payment/order 轉 PAID、預扣實扣、enqueue 三個後續工作', async () => {
    const { order, variant } = await createTestOrder({ qty: 2 })
    const params = signedPaymentReturnParams(order)

    await handlePaymentReturn(params)

    const fresh = await reloadOrder(order.id)
    expect(fresh.status).toBe('PAID')
    expect(fresh.paidAt).not.toBeNull()
    expect(fresh.payment?.status).toBe('PAID')
    expect(fresh.payment?.tradeNo).toBe(params.TradeNo)
    expect(fresh.payment?.paymentType).toBe('Credit_CreditCard')
    // PaymentDate 沒有時區標記，必須被解讀成 +08:00
    expect(fresh.payment?.paidAt?.getTime()).toBe(ecpayDateToUtc(params.PaymentDate).getTime())

    // 預扣轉實扣：stock 實際扣掉、reservedStock 歸零、committedAt 設定
    expect(fresh.reservations[0]?.committedAt).not.toBeNull()
    const v = await freshVariant(variant.id)
    expect(v.stock).toBe(8)
    expect(v.reservedStock).toBe(0)

    expect(jobs()).toEqual([
      ['create-shipment', { orderId: order.id }],
      ['issue-receipt', { orderId: order.id }],
      ['send-email', { template: 'order-confirmed', orderId: order.id }],
    ])
  })

  it('ECPAY_RECEIPT_AUTO_ISSUE=false 時不 enqueue issue-receipt', async () => {
    const original = env.ECPAY_RECEIPT_AUTO_ISSUE
    env.ECPAY_RECEIPT_AUTO_ISSUE = false
    try {
      const { order } = await createTestOrder()
      await handlePaymentReturn(signedPaymentReturnParams(order))

      const names = jobs().map(([name]) => name)
      expect(names).toEqual(['create-shipment', 'send-email'])
    } finally {
      env.ECPAY_RECEIPT_AUTO_ISSUE = original
    }
  })

  it('stage 環境的模擬付款（SimulatePaid=1）照常處理', async () => {
    // signedPaymentReturnParams 預設就是 SimulatePaid=1；FAKE_TEST_ENV 是 stage
    const { order } = await createTestOrder()
    await handlePaymentReturn(signedPaymentReturnParams(order, { SimulatePaid: '1' }))

    const fresh = await reloadOrder(order.id)
    expect(fresh.status).toBe('PAID')
    expect(fresh.payment?.status).toBe('PAID')
  })

  it('成功時 rawCallback 原樣存入', async () => {
    const { order } = await createTestOrder()
    const params = signedPaymentReturnParams(order)

    await handlePaymentReturn(params)

    const fresh = await reloadOrder(order.id)
    expect(fresh.payment?.rawCallback).toEqual(params)
  })
})

describe('handlePaymentReturn — 失敗與防禦', () => {
  it('RtnCode 不是 1：payment 標 FAILED 留下原因，訂單與預扣不動、不 throw', async () => {
    const { order, variant } = await createTestOrder()
    const params = signedPaymentReturnParams(order, {
      RtnCode: '10200095',
      RtnMsg: '交易失敗',
    })

    await expect(handlePaymentReturn(params)).resolves.toBeUndefined()

    const fresh = await reloadOrder(order.id)
    expect(fresh.status).toBe('PENDING_PAYMENT')
    expect(fresh.payment?.status).toBe('FAILED')
    expect(fresh.payment?.failReason).toBe('10200095: 交易失敗')
    expect(fresh.reservations[0]?.committedAt).toBeNull()
    const v = await freshVariant(variant.id)
    expect(v.stock).toBe(10)
    expect(v.reservedStock).toBe(1)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('金額被竄改（TradeAmt 不符）：payment FAILED 並 throw，訂單不動', async () => {
    const { order, variant } = await createTestOrder()
    const params = signedPaymentReturnParams(order, { TradeAmt: '1' })

    await expect(handlePaymentReturn(params)).rejects.toThrow(/付款金額不符/)

    const fresh = await reloadOrder(order.id)
    expect(fresh.status).toBe('PENDING_PAYMENT')
    expect(fresh.payment?.status).toBe('FAILED')
    expect(fresh.payment?.failReason).toContain('金額不符')
    expect(fresh.reservations[0]?.committedAt).toBeNull()
    expect((await freshVariant(variant.id)).stock).toBe(10)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('正式環境收到 SimulatePaid=1 一律拒絕：payment FAILED 並 throw', async () => {
    const original = env.ECPAY_ENV
    env.ECPAY_ENV = 'production'
    try {
      const { order } = await createTestOrder()
      const params = signedPaymentReturnParams(order, { SimulatePaid: '1' })

      await expect(handlePaymentReturn(params)).rejects.toThrow(/模擬付款/)

      const fresh = await reloadOrder(order.id)
      expect(fresh.status).toBe('PENDING_PAYMENT')
      expect(fresh.payment?.status).toBe('FAILED')
      expect(fresh.payment?.failReason).toContain('SimulatePaid=1')
      expect(enqueueMock).not.toHaveBeenCalled()
    } finally {
      env.ECPAY_ENV = original
    }
  })

  it('缺 MerchantTradeNo 或找不到付款紀錄都要 throw', async () => {
    await expect(handlePaymentReturn({})).rejects.toThrow('回拋缺少 MerchantTradeNo')
    await expect(
      handlePaymentReturn({ MerchantTradeNo: 'NOSUCHORDER123', RtnCode: '1', TradeAmt: '100' }),
    ).rejects.toThrow(/找不到對應的付款紀錄/)
  })
})

describe('handlePaymentReturn — 冪等與競態', () => {
  it('同一個回拋依序處理兩次：第二次無作用，stock 只扣一次', async () => {
    const { order, variant } = await createTestOrder({ qty: 2 })
    const params = signedPaymentReturnParams(order)

    await handlePaymentReturn(params)
    await handlePaymentReturn(params)

    const v = await freshVariant(variant.id)
    expect(v.stock).toBe(8) // 不是 6
    expect(v.reservedStock).toBe(0)
    // 第二次在交易外就提前結束，不會重複 enqueue
    expect(jobs()).toHaveLength(3)
  })

  it('兩個相同回拋同時進來：都 resolve、stock 恰扣一次、預扣只 commit 一次', async () => {
    const { order, variant } = await createTestOrder({ qty: 2 })
    const params = signedPaymentReturnParams(order)

    await Promise.all([handlePaymentReturn(params), handlePaymentReturn(params)])

    const fresh = await reloadOrder(order.id)
    expect(fresh.status).toBe('PAID')
    expect(fresh.payment?.status).toBe('PAID')
    expect(fresh.reservations).toHaveLength(1)
    expect(fresh.reservations[0]?.committedAt).not.toBeNull()
    expect(fresh.reservations[0]?.releasedAt).toBeNull()

    const v = await freshVariant(variant.id)
    expect(v.stock).toBe(8) // 兩個交易也只能扣一次
    expect(v.reservedStock).toBe(0)
  })

  it('逾期入帳：訂單已取消才收到付款 → payment PAID 並註記人工退款，訂單留在 CANCELLED', async () => {
    const { order, variant } = await createTestOrder({
      status: 'CANCELLED',
      paymentStatus: 'PENDING',
    })
    const params = signedPaymentReturnParams(order)

    // 修復後行為：不 throw、留下紀錄
    await expect(handlePaymentReturn(params)).resolves.toBeUndefined()

    const fresh = await reloadOrder(order.id)
    expect(fresh.status).toBe('CANCELLED')
    expect(fresh.payment?.status).toBe('PAID')
    expect(fresh.payment?.tradeNo).toBe(params.TradeNo)
    expect(fresh.payment?.failReason).toBe('逾期入帳：訂單已取消但仍收到付款，需人工退款')
    // 不 commit 預扣、不 enqueue 任何後續工作
    expect(fresh.reservations[0]?.committedAt).toBeNull()
    expect((await freshVariant(variant.id)).stock).toBe(10)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('C-05：到期釋放與付款通知同時發生，終態必為合法組合且不變量成立', async () => {
    const { order, variant } = await createTestOrder({
      qty: 1,
      reservationExpiresAt: new Date(Date.now() - 60_000),
    })
    const params = signedPaymentReturnParams(order)

    // 兩邊的交易鎖定順序不同，理論上可能死鎖被 Postgres 砍掉一邊，
    // 所以用 allSettled —— 重點是資料的終態不變量，不是兩邊都成功。
    await Promise.allSettled([releaseExpiredReservations(), handlePaymentReturn(params)])

    const fresh = await reloadOrder(order.id)
    const reservation = fresh.reservations[0]
    const v = await freshVariant(variant.id)

    // 不變量：reservedStock 不為負、預扣不得同時 committed 且 released
    expect(v.reservedStock).toBeGreaterThanOrEqual(0)
    expect(reservation.committedAt !== null && reservation.releasedAt !== null).toBe(false)

    expect(['PAID', 'CANCELLED']).toContain(fresh.status)
    if (fresh.status === 'PAID') {
      // (b) 付款先贏：預扣已 commit、實際扣庫存
      expect(fresh.payment?.status).toBe('PAID')
      expect(reservation.committedAt).not.toBeNull()
      expect(v.stock).toBe(9)
      expect(v.reservedStock).toBe(0)
    } else {
      // (a) 釋放先贏：預扣已還、庫存回到原狀；payment 是 EXPIRED，
      //     或付款通知較晚進來被記成「逾期入帳」的 PAID
      expect(reservation.releasedAt).not.toBeNull()
      expect(reservation.committedAt).toBeNull()
      expect(v.stock).toBe(10)
      expect(v.reservedStock).toBe(0)
      if (fresh.payment?.status === 'PAID') {
        expect(fresh.payment.failReason).toContain('逾期入帳')
      } else {
        expect(fresh.payment?.status).toBe('EXPIRED')
      }
    }
  })
})

describe('handlePaymentInfo — ATM / CVS 取號通知', () => {
  it('ATM 取號：轉 AWAITING_TRANSFER、存虛擬帳號並 enqueue 繳費資訊信', async () => {
    const { order } = await createTestOrder({ choosePayment: 'ATM' })
    const params = signedPaymentInfoParams(order)

    await handlePaymentInfo(params)

    const fresh = await reloadOrder(order.id)
    expect(fresh.payment?.status).toBe('AWAITING_TRANSFER')
    expect(fresh.payment?.paymentType).toBe('ATM_TAISHIN')
    expect(fresh.payment?.bankCode).toBe('812')
    expect(fresh.payment?.vAccount).toBe('9990012345678901')
    expect(fresh.payment?.expireDate).toBe('2026/12/31')
    expect(fresh.payment?.rawCallback).toEqual(params)
    // 取號不是付款：訂單維持待付款、預扣不 commit
    expect(fresh.status).toBe('PENDING_PAYMENT')
    expect(fresh.reservations[0]?.committedAt).toBeNull()

    expect(jobs()).toEqual([['send-email', { template: 'payment-info', orderId: order.id }]])
  })

  it('CVS 取號：存繳費代碼 PaymentNo', async () => {
    const { order } = await createTestOrder({ choosePayment: 'CVS' })
    const params = signedCvsPaymentInfoParams(order)

    await handlePaymentInfo(params)

    const fresh = await reloadOrder(order.id)
    expect(fresh.payment?.status).toBe('AWAITING_TRANSFER')
    expect(fresh.payment?.paymentType).toBe('CVS_CVS')
    expect(fresh.payment?.paymentNo).toBe('LLL22167774958')
  })

  it('缺 MerchantTradeNo 或找不到付款紀錄都要 throw', async () => {
    await expect(handlePaymentInfo({})).rejects.toThrow('回拋缺少 MerchantTradeNo')
    await expect(handlePaymentInfo({ MerchantTradeNo: 'NOSUCHORDER456' })).rejects.toThrow(
      /找不到對應的付款紀錄/,
    )
  })
})

describe('parseEcpayDate', () => {
  it('正確以 +08:00 解析綠界日期', () => {
    const parsed = parseEcpayDate('2026/08/15 10:30:00')
    expect(parsed?.toISOString()).toBe('2026-08-15T02:30:00.000Z')
  })

  it('格式不符回 null', () => {
    expect(parseEcpayDate('2026-08-15 10:30:00')).toBeNull()
    expect(parseEcpayDate('2026/8/15 10:30')).toBeNull()
    expect(parseEcpayDate('亂七八糟')).toBeNull()
    expect(parseEcpayDate('')).toBeNull()
  })

  it('undefined 回 null', () => {
    expect(parseEcpayDate(undefined)).toBeNull()
  })
})
