import { describe, it, expect } from 'vitest'
import type { Payment } from '@prisma/client'
import { refundEligibility } from './refund'

const SETTINGS = { refundWindowDays: 7 }
const NOW = new Date('2026-08-22T12:00:00+08:00')

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'pay_1',
    orderId: 'order_1',
    provider: 'ECPAY',
    merchantTradeNo: 'SG123',
    tradeNo: '2608221200123456',
    choosePayment: 'Credit',
    paymentType: 'Credit_CreditCard',
    amount: 1200,
    status: 'PAID',
    bankCode: null,
    vAccount: null,
    paymentNo: null,
    barcode1: null,
    barcode2: null,
    barcode3: null,
    expireDate: null,
    rawCallback: null,
    failReason: null,
    supersededAt: null,
    syncedAt: null,
    paidAt: new Date('2026-08-10T10:00:00+08:00'),
    createdAt: new Date('2026-08-10T09:00:00+08:00'),
    updatedAt: new Date('2026-08-10T10:00:00+08:00'),
    ...overrides,
  } as Payment
}

function order(overrides: Partial<Parameters<typeof refundEligibility>[0]> = {}) {
  return {
    status: 'PROCESSING' as const,
    paidAt: new Date('2026-08-10T10:00:00+08:00'),
    payments: [payment()],
    shipment: null,
    refunds: [],
    ...overrides,
  }
}

describe('refundEligibility', () => {
  it('已付款、還沒送到的訂單隨時可以申請', () => {
    expect(refundEligibility(order(), SETTINGS, NOW).eligible).toBe(true)
    expect(refundEligibility(order({ status: 'SHIPPED' }), SETTINGS, NOW).eligible).toBe(true)
  })

  it('沒收到錢就不是退款問題（貨到付款取貨前要的是取消訂單）', () => {
    const cod = order({
      status: 'PROCESSING',
      paidAt: null,
      payments: [payment({ provider: 'COD', choosePayment: 'COD', status: 'AWAITING_COLLECTION', paidAt: null })],
    })
    const result = refundEligibility(cod, SETTINGS, NOW)
    expect(result.eligible).toBe(false)
    expect(result.reasonKey).toBe('notPaid')
  })

  it('已取消的訂單沒有款項可退', () => {
    const result = refundEligibility(order({ status: 'CANCELLED' }), SETTINGS, NOW)
    expect(result.reasonKey).toBe('cancelled')
  })

  it('已經有一筆在處理的申請就不給重複送', () => {
    for (const status of ['REQUESTED', 'APPROVED'] as const) {
      const result = refundEligibility(order({ refunds: [{ status }] }), SETTINGS, NOW)
      expect(result.reasonKey).toBe('alreadyRequested')
    }
    // 被拒絕過的可以再申請（客服可能是要求補資料）
    expect(refundEligibility(order({ refunds: [{ status: 'REJECTED' }] }), SETTINGS, NOW).eligible).toBe(
      true,
    )
  })

  /**
   * 期限從「取貨」開始算，不是從出貨或付款 ——
   * 超商包裹可以放到店 7 天，用出貨日算的話消費者領到手時猶豫期已經過完了。
   */
  it('已取貨的訂單從取貨時間起算 refundWindowDays', () => {
    const justPicked = order({
      status: 'COMPLETED',
      shipment: { status: 'PICKED_UP', updatedAt: new Date('2026-08-20T18:00:00+08:00') },
    })
    expect(refundEligibility(justPicked, SETTINGS, NOW).eligible).toBe(true)

    const longAgo = order({
      status: 'COMPLETED',
      shipment: { status: 'PICKED_UP', updatedAt: new Date('2026-08-10T18:00:00+08:00') },
    })
    expect(refundEligibility(longAgo, SETTINGS, NOW).reasonKey).toBe('windowClosed')
  })

  it('信用卡不用留帳戶，其他付款方式一定要（綠界沒有非信用卡的退款 API）', () => {
    expect(refundEligibility(order(), SETTINGS, NOW).needsBankAccount).toBe(false)

    const atm = order({
      payments: [payment({ choosePayment: 'ATM', paymentType: 'ATM_TAISHIN' })],
    })
    expect(refundEligibility(atm, SETTINGS, NOW).needsBankAccount).toBe(true)

    const cvs = order({ payments: [payment({ choosePayment: 'CVS', paymentType: 'CVS' })] })
    expect(refundEligibility(cvs, SETTINGS, NOW).needsBankAccount).toBe(true)
  })

  it('看的是目前生效的付款方式，不是被作廢的舊那筆', () => {
    const switched = order({
      payments: [
        payment({ id: 'new', choosePayment: 'Credit', createdAt: new Date('2026-08-11T09:00:00+08:00') }),
        payment({
          id: 'old',
          choosePayment: 'CVS',
          paymentType: 'CVS',
          status: 'EXPIRED',
          supersededAt: new Date('2026-08-11T09:00:00+08:00'),
        }),
      ],
    })
    expect(refundEligibility(switched, SETTINGS, NOW).needsBankAccount).toBe(false)
  })
})
