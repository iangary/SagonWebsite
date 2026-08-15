import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { createTestOrder, reloadOrder } from '../factories'

// 只 mock 對外的 HTTP（issueReceipt / invalidReceipt），
// buildIssuePayload 等純函式維持真實（callReceiptApi 是模組私有，包在這兩支裡）
vi.mock('@/lib/ecpay/receipt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ecpay/receipt')>()
  return { ...actual, issueReceipt: vi.fn(), invalidReceipt: vi.fn() }
})

import { invalidReceipt, issueReceipt } from '@/lib/ecpay/receipt'
import { issueReceiptForOrder, voidReceiptForOrder } from '@/lib/orders/receipt'

const issueReceiptMock = vi.mocked(issueReceipt)
const invalidReceiptMock = vi.mocked(invalidReceipt)

beforeEach(() => {
  vi.resetAllMocks()
})

describe('issueReceiptForOrder', () => {
  it('happy path：RelateNumber 用訂單編號、品項含商品/運費/負數折扣、開立後寫回收據', async () => {
    // 500 x 2 + 運費 60 - 折扣 50 = 1010
    const { order } = await createTestOrder({
      status: 'PAID',
      qty: 2,
      unitPrice: 500,
      shippingFee: 60,
      discountTotal: 50,
    })
    issueReceiptMock.mockResolvedValue({ RtnCode: 1, RtnMsg: 'Success', ReceiptNo: 'RC0001' })

    await issueReceiptForOrder(order.id)

    expect(issueReceiptMock).toHaveBeenCalledTimes(1)
    expect(issueReceiptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        relateNumber: order.orderNo,
        name: '測試買家',
        email: 'buyer@test.local',
        amount: 1010,
        items: [
          { name: '測試商品', count: 2, price: 500 },
          { name: '運費', count: 1, price: 60 },
          { name: '折扣', count: 1, price: -50 },
        ],
      }),
    )

    const fresh = await reloadOrder(order.id)
    expect(fresh.receipt?.status).toBe('ISSUED')
    expect(fresh.receipt?.receiptNo).toBe('RC0001')
    expect(fresh.receipt?.issuedAt).not.toBeNull()
    expect(fresh.receipt?.failReason).toBeNull()
    expect(fresh.receipt?.rawResponse).toEqual({ RtnCode: 1, RtnMsg: 'Success', ReceiptNo: 'RC0001' })
  })

  it('免運且無折扣：品項只有商品列，不出現運費與折扣', async () => {
    const { order } = await createTestOrder({
      status: 'PAID',
      qty: 1,
      unitPrice: 800,
      shippingFee: 0,
      discountTotal: 0,
    })
    issueReceiptMock.mockResolvedValue({ RtnCode: 1, RtnMsg: 'Success', ReceiptNo: 'RC0002' })

    await issueReceiptForOrder(order.id)

    const input = issueReceiptMock.mock.calls[0]![0]
    expect(input.items).toEqual([{ name: '測試商品', count: 1, price: 800 }])
    expect(input.amount).toBe(800)
  })

  it('品項金額加總恆等於 Amount（綠界會核對，不一致直接退件）', async () => {
    const { order } = await createTestOrder({
      status: 'PAID',
      qty: 3,
      unitPrice: 350,
      shippingFee: 0,
      discountTotal: 100,
    })
    issueReceiptMock.mockResolvedValue({ RtnCode: 1, RtnMsg: 'Success', ReceiptNo: 'RC0003' })

    await issueReceiptForOrder(order.id)

    const input = issueReceiptMock.mock.calls[0]![0]
    const itemsTotal = input.items.reduce((sum, item) => sum + item.price * item.count, 0)
    expect(itemsTotal).toBe(input.amount)
    expect(input.amount).toBe(order.grandTotal)
  })

  it('receiptNo 已存在（開過了）：直接跳過，不打綠界', async () => {
    const { order } = await createTestOrder({ status: 'PAID' })
    await db.receipt.update({
      where: { orderId: order.id },
      data: { receiptNo: 'RC-DONE', status: 'ISSUED' },
    })

    await expect(issueReceiptForOrder(order.id)).resolves.toBeUndefined()
    expect(issueReceiptMock).not.toHaveBeenCalled()
  })

  it('CANCELLED 訂單：跳過不開立', async () => {
    const { order } = await createTestOrder({ status: 'CANCELLED' })

    await expect(issueReceiptForOrder(order.id)).resolves.toBeUndefined()
    expect(issueReceiptMock).not.toHaveBeenCalled()
    expect((await reloadOrder(order.id)).receipt?.status).toBe('PENDING')
  })

  it('訂單沒有 receipt 資料列：throw', async () => {
    const { order } = await createTestOrder({ status: 'PAID' })
    await db.receipt.delete({ where: { orderId: order.id } })

    await expect(issueReceiptForOrder(order.id)).rejects.toThrow('訂單沒有收據資料')
  })

  it('綠界回 RtnCode≠1：收據標 FAILED、failReason 帶回覆訊息、throw 讓 BullMQ 重試', async () => {
    const { order } = await createTestOrder({ status: 'PAID' })
    issueReceiptMock.mockResolvedValue({ RtnCode: 5000000, RtnMsg: 'RelateNumber 重複' })

    await expect(issueReceiptForOrder(order.id)).rejects.toThrow('開立收據失敗')

    const fresh = await reloadOrder(order.id)
    expect(fresh.receipt?.status).toBe('FAILED')
    expect(fresh.receipt?.failReason).toContain('RelateNumber 重複')
    expect(fresh.receipt?.receiptNo).toBeNull()
    // 綠界的原始回應要留著對帳
    expect(fresh.receipt?.rawResponse).toEqual({ RtnCode: 5000000, RtnMsg: 'RelateNumber 重複' })
  })

  it('issueReceipt reject（網路錯誤）：收據標 FAILED 並把錯誤往上丟', async () => {
    const { order } = await createTestOrder({ status: 'PAID' })
    issueReceiptMock.mockRejectedValue(new Error('fetch failed'))

    await expect(issueReceiptForOrder(order.id)).rejects.toThrow('fetch failed')

    const fresh = await reloadOrder(order.id)
    expect(fresh.receipt?.status).toBe('FAILED')
    expect(fresh.receipt?.failReason).toBe('fetch failed')
  })
})

describe('voidReceiptForOrder', () => {
  async function issuedOrder() {
    const { order } = await createTestOrder({ status: 'REFUNDED' })
    await db.receipt.update({
      where: { orderId: order.id },
      data: { receiptNo: `RC-${order.orderNo}`, status: 'ISSUED', issuedAt: new Date() },
    })
    return order
  }

  it('happy path：作廢成功 → VOIDED + voidedAt + voidReason（截 200 字）；已 VOIDED 再呼叫是 no-op；沒開過則 throw', async () => {
    const order = await issuedOrder()
    invalidReceiptMock.mockResolvedValue({ RtnCode: 1, RtnMsg: 'Success' })
    const longReason = '客'.repeat(250)

    await voidReceiptForOrder(order.id, longReason)

    expect(invalidReceiptMock).toHaveBeenCalledWith(`RC-${order.orderNo}`, longReason)

    let fresh = await reloadOrder(order.id)
    expect(fresh.receipt?.status).toBe('VOIDED')
    expect(fresh.receipt?.voidedAt).not.toBeNull()
    expect(fresh.receipt?.voidReason).toHaveLength(200)

    // 已作廢 → no-op，不會再打綠界
    await expect(voidReceiptForOrder(order.id, '再作廢一次')).resolves.toBeUndefined()
    expect(invalidReceiptMock).toHaveBeenCalledTimes(1)
    fresh = await reloadOrder(order.id)
    expect(fresh.receipt?.status).toBe('VOIDED')

    // 沒有 receiptNo（沒開過收據）→ throw
    const { order: neverIssued } = await createTestOrder({ status: 'PAID' })
    await expect(voidReceiptForOrder(neverIssued.id, '退款')).rejects.toThrow(
      '這張訂單沒有已開立的收據',
    )
  })

  it('作廢被綠界拒絕（RtnCode≠1）：throw 且收據狀態不變', async () => {
    const order = await issuedOrder()
    invalidReceiptMock.mockResolvedValue({ RtnCode: 0, RtnMsg: '收據不存在' })

    await expect(voidReceiptForOrder(order.id, '退款')).rejects.toThrow('作廢收據失敗')

    const fresh = await reloadOrder(order.id)
    expect(fresh.receipt?.status).toBe('ISSUED')
    expect(fresh.receipt?.voidedAt).toBeNull()
    expect(fresh.receipt?.voidReason).toBeNull()
  })
})
