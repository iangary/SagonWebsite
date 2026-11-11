import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/queue', async () => (await import('./mocks')).queueMockModule())

import { db } from '@/lib/db'
import { handlePaymentInfo, handlePaymentReturn } from '@/lib/orders/payment'
import { DEFAULT_PAYMENT_SETTINGS } from '@/lib/shop-settings'
import { GET } from '@/app/api/ecpay/payment/checkout/[orderNo]/route'
import { createTestOrder, reloadOrder } from '../factories'
import { signedCvsPaymentInfoParams, signedPaymentReturnParams } from './helpers/ecpay'

/**
 * 「前往付款」重送綠界：綠界同一組 MerchantTradeNo 只收一次（10300028 訂單編號重複）。
 * 客人進了收銀台沒付款、回來再按一次，或刷卡失敗再試，都要換一組新的單號。
 */

async function goToCheckout(orderNo: string) {
  const res = await GET(new Request(`http://test.local/api/ecpay/payment/checkout/${orderNo}`), {
    params: Promise.resolve({ orderNo }),
  })
  const html = res.headers.get('content-type')?.includes('text/html') ? await res.text() : ''
  const sentTradeNo = /name="MerchantTradeNo" value="([^"]+)"/.exec(html)?.[1] ?? null
  return { status: res.status, location: res.headers.get('location'), sentTradeNo }
}

beforeEach(async () => {
  await db.shopSetting.create({
    data: {
      key: 'payment',
      value: { ...DEFAULT_PAYMENT_SETTINGS, methods: { ...DEFAULT_PAYMENT_SETTINGS.methods, CVS: true } },
    },
  })
})

describe('前往付款：送過綠界的單號不再重送', () => {
  it('第一次照原本的單號送；第二次換一組新的，舊的那筆作廢但留著', async () => {
    const { order } = await createTestOrder({ choosePayment: 'Credit' })
    const original = await db.payment.findFirstOrThrow({ where: { orderId: order.id } })

    const first = await goToCheckout(order.orderNo)
    expect(first.sentTradeNo).toBe(original.merchantTradeNo)

    const second = await goToCheckout(order.orderNo)
    expect(second.sentTradeNo).not.toBeNull()
    expect(second.sentTradeNo).not.toBe(original.merchantTradeNo)

    const third = await goToCheckout(order.orderNo)
    expect(third.sentTradeNo).not.toBe(second.sentTradeNo)

    const payments = await db.payment.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } })
    expect(payments).toHaveLength(3)
    expect(payments.filter((p) => p.supersededAt === null)).toHaveLength(1)
    expect(payments[0]).toMatchObject({ id: original.id, status: 'EXPIRED' })
    expect(payments.every((p) => p.choosePayment === 'Credit' && p.amount === order.grandTotal)).toBe(true)
  })

  it('刷卡失敗後再試：換新單號', async () => {
    const { order } = await createTestOrder({ choosePayment: 'Credit' })
    const original = await db.payment.findFirstOrThrow({ where: { orderId: order.id } })
    await goToCheckout(order.orderNo)
    await handlePaymentReturn(
      signedPaymentReturnParams(
        { grandTotal: order.grandTotal, payment: { merchantTradeNo: original.merchantTradeNo } },
        { RtnCode: '10100058', RtnMsg: '授權失敗' },
      ),
    )
    expect((await db.payment.findUniqueOrThrow({ where: { id: original.id } })).status).toBe('FAILED')

    const retry = await goToCheckout(order.orderNo)
    expect(retry.sentTradeNo).not.toBeNull()
    expect(retry.sentTradeNo).not.toBe(original.merchantTradeNo)
  })

  it('舊分頁其實把舊單號付掉了：照樣入帳，新的那組作廢', async () => {
    const { order } = await createTestOrder({ choosePayment: 'Credit' })
    const original = await db.payment.findFirstOrThrow({ where: { orderId: order.id } })
    await goToCheckout(order.orderNo)
    await goToCheckout(order.orderNo) // 換了一組新的

    await handlePaymentReturn(
      signedPaymentReturnParams({
        grandTotal: order.grandTotal,
        payment: { merchantTradeNo: original.merchantTradeNo },
      }),
    )

    const fresh = await reloadOrder(order.id)
    expect(fresh.status).toBe('PAID')
    expect(fresh.payment?.id).toBe(original.id)
    const other = await db.payment.findFirstOrThrow({ where: { orderId: order.id, id: { not: original.id } } })
    expect(other.status).toBe('EXPIRED')
    expect(await db.refundRequest.count({ where: { orderId: order.id } })).toBe(0)
  })

  it('超商代碼已經取號：不再送綠界，導回結果頁看代碼', async () => {
    const { order } = await createTestOrder({ choosePayment: 'CVS' })
    await goToCheckout(order.orderNo)
    await handlePaymentInfo(signedCvsPaymentInfoParams(order))

    const again = await goToCheckout(order.orderNo)
    expect(again.status).toBe(303)
    expect(again.location).toContain(`/checkout/result?orderNo=${order.orderNo}`)
    expect(await db.payment.count({ where: { orderId: order.id } })).toBe(1)
  })

  it('已付款的訂單：導回結果頁，不產生新單號', async () => {
    const { order } = await createTestOrder({ choosePayment: 'Credit', status: 'PAID' })
    const again = await goToCheckout(order.orderNo)
    expect(again.status).toBe(303)
    expect(await db.payment.count({ where: { orderId: order.id } })).toBe(1)
  })
})
