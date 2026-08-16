import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { generateCheckMacValue } from '@/lib/ecpay/checkmac'
import { createTestOrder, reloadOrder } from '../factories'
import { enqueueMock } from './mocks'
import {
  callbackRequest,
  signedPaymentInfoParams,
  signedPaymentReturnParams,
} from './helpers/ecpay'

vi.mock('@/lib/queue', async () => (await import('./mocks')).queueMockModule())

import { POST as paymentReturnPost } from '@/app/api/ecpay/payment/return/route'
import { POST as paymentInfoPost } from '@/app/api/ecpay/payment/info/route'
import {
  GET as paymentResultGet,
  POST as paymentResultPost,
} from '@/app/api/ecpay/payment/result/route'
import { POST as logisticsReplyPost } from '@/app/api/ecpay/logistics/reply/route'

/**
 * 綠界回拋 route handler 的整合測試：直接呼叫 POST(request)，
 * 簽章用正式的 generateCheckMacValue 產生，走真實資料庫。
 */

type RouteHandler = (req: Request) => Promise<Response>
const paymentReturn = paymentReturnPost as unknown as RouteHandler
const paymentInfo = paymentInfoPost as unknown as RouteHandler
const paymentResult = paymentResultPost as unknown as RouteHandler
const paymentResultView = paymentResultGet as unknown as RouteHandler
const logisticsReply = logisticsReplyPost as unknown as RouteHandler

/** 訂單目前所有「會被付款改到」的欄位，用來斷言「一個字都沒動」 */
async function orderFingerprint(orderId: string) {
  const o = await reloadOrder(orderId)
  return {
    status: o.status,
    paidAt: o.paidAt,
    paymentStatus: o.payment?.status,
    tradeNo: o.payment?.tradeNo,
    paidAtPayment: o.payment?.paidAt,
    failReason: o.payment?.failReason,
  }
}

/** 物流回拋用的是物流商店的憑證且演算法是 MD5，跟金流那組不同 */
function signedLogisticsParams(params: Record<string, string>): Record<string, string> {
  const creds = {
    hashKey: env.ECPAY_LOGISTICS_HASH_KEY,
    hashIV: env.ECPAY_LOGISTICS_HASH_IV,
  }
  return { ...params, CheckMacValue: generateCheckMacValue(params, creds, 'md5') }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/ecpay/payment/return', () => {
  it('簽章正確的成功回拋：回 1|OK、訂單轉 PAID、事件標記已處理、庫存轉實扣', async () => {
    const { order, variant } = await createTestOrder()
    const params = signedPaymentReturnParams(order)

    const res = await paymentReturn(callbackRequest('/api/ecpay/payment/return', params))

    expect(await res.text()).toBe('1|OK')

    const fresh = await reloadOrder(order.id)
    expect(fresh.status).toBe('PAID')
    expect(fresh.paidAt).not.toBeNull()
    expect(fresh.payment?.status).toBe('PAID')
    expect(fresh.payment?.tradeNo).toBe(params.TradeNo)

    const event = await db.webhookEvent.findFirstOrThrow({
      where: { kind: 'payment_return', merchantTradeNo: order.orderNo },
    })
    expect(event.processedAt).not.toBeNull()
    expect(event.signatureValid).toBe(true)

    // 預扣轉實扣：stock 10 - 1、reservedStock 歸零
    const freshVariant = await db.productVariant.findUniqueOrThrow({ where: { id: variant.id } })
    expect(freshVariant.stock).toBe(9)
    expect(freshVariant.reservedStock).toBe(0)

    // 後續動作全部丟進佇列
    // enqueueMock 在 mocks.ts 的型別是無參數的 vi.fn，這裡取實際收到的 job 名稱
    const jobs = enqueueMock.mock.calls.map((call) => (call as unknown as [string])[0])
    expect(jobs).toContain('create-shipment')
    expect(jobs).toContain('issue-receipt') // ECPAY_RECEIPT_AUTO_ISSUE 預設開
    expect(jobs).toContain('send-email')
  })

  it('CheckMacValue 被竄改：回 0|CheckMacValue Error、事件記 signatureValid=false、訂單不動', async () => {
    const { order } = await createTestOrder()
    const params = signedPaymentReturnParams(order)
    params.CheckMacValue = '0'.repeat(64)

    const res = await paymentReturn(callbackRequest('/api/ecpay/payment/return', params))

    expect(await res.text()).toBe('0|CheckMacValue Error')

    const event = await db.webhookEvent.findFirstOrThrow({
      where: { kind: 'payment_return', merchantTradeNo: order.orderNo },
    })
    expect(event.signatureValid).toBe(false)
    expect(event.processedAt).toBeNull()
    expect(event.error).toContain('CheckMacValue')

    const fresh = await reloadOrder(order.id)
    expect(fresh.status).toBe('PENDING_PAYMENT')
    expect(fresh.payment?.status).toBe('PENDING')
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('完全相同的回拋重送：第二次走 fast-path 回 1|OK，庫存只扣一次', async () => {
    const { order, variant } = await createTestOrder()
    const params = signedPaymentReturnParams(order)

    const first = await paymentReturn(callbackRequest('/api/ecpay/payment/return', params))
    expect(await first.text()).toBe('1|OK')

    const second = await paymentReturn(callbackRequest('/api/ecpay/payment/return', params))
    expect(await second.text()).toBe('1|OK')

    const freshVariant = await db.productVariant.findUniqueOrThrow({ where: { id: variant.id } })
    expect(freshVariant.stock).toBe(9)
    expect(freshVariant.reservedStock).toBe(0)

    // fast-path 不會再處理一次，attempts 停在第一次的 1
    const event = await db.webhookEvent.findFirstOrThrow({
      where: { kind: 'payment_return', merchantTradeNo: order.orderNo },
    })
    expect(event.attempts).toBe(1)
    expect(await db.webhookEvent.count({ where: { kind: 'payment_return' } })).toBe(1)
  })

  it('金額不符：回 0|Internal Error、事件記 error 且 attempts 遞增、payment 標 FAILED', async () => {
    const { order } = await createTestOrder()
    const params = signedPaymentReturnParams(order, { TradeAmt: '1' })

    const res = await paymentReturn(callbackRequest('/api/ecpay/payment/return', params))

    expect(await res.text()).toBe('0|Internal Error')

    const event = await db.webhookEvent.findFirstOrThrow({
      where: { kind: 'payment_return', merchantTradeNo: order.orderNo },
    })
    expect(event.processedAt).toBeNull()
    expect(event.attempts).toBe(1)
    expect(event.error).toContain('付款金額不符')

    const fresh = await reloadOrder(order.id)
    expect(fresh.status).toBe('PENDING_PAYMENT')
    expect(fresh.payment?.status).toBe('FAILED')
    expect(fresh.payment?.failReason).toContain('金額不符')
  })

  it('處理失敗後同樣的 params 重送：不會走 fast-path，會再處理一次（attempts 變 2）', async () => {
    const { order } = await createTestOrder()
    const params = signedPaymentReturnParams(order, { TradeAmt: '1' })

    await paymentReturn(callbackRequest('/api/ecpay/payment/return', params))
    const res = await paymentReturn(callbackRequest('/api/ecpay/payment/return', params))

    expect(await res.text()).toBe('0|Internal Error')

    const event = await db.webhookEvent.findFirstOrThrow({
      where: { kind: 'payment_return', merchantTradeNo: order.orderNo },
    })
    expect(event.attempts).toBe(2)
    expect(event.processedAt).toBeNull()
    expect(await db.webhookEvent.count({ where: { kind: 'payment_return' } })).toBe(1)
  })

  it('UTF-8 的 RtnMsg 經過 form-urlencoded 往返後不會壞掉', async () => {
    const { order } = await createTestOrder()
    const message = '交易成功（測試：中文、全形符號＆空白 OK）'
    const params = signedPaymentReturnParams(order, { RtnMsg: message })

    const res = await paymentReturn(callbackRequest('/api/ecpay/payment/return', params))
    expect(await res.text()).toBe('1|OK')

    const event = await db.webhookEvent.findFirstOrThrow({
      where: { kind: 'payment_return', merchantTradeNo: order.orderNo },
    })
    // 簽章驗過（代表中文參與簽章計算也一致），payload 原文入庫
    expect(event.signatureValid).toBe(true)
    expect((event.payload as Record<string, string>).RtnMsg).toBe(message)
  })

  it('逾期入帳安全網：訂單已 CANCELLED 仍收到成功回拋，回 1|OK 且 payment 轉 PAID 待人工退款', async () => {
    const { order } = await createTestOrder({ status: 'CANCELLED', paymentStatus: 'PENDING' })
    const params = signedPaymentReturnParams(order)

    const res = await paymentReturn(callbackRequest('/api/ecpay/payment/return', params))

    expect(await res.text()).toBe('1|OK')

    const fresh = await reloadOrder(order.id)
    // 訂單維持取消，但錢確實進來了，要留下人工退款的紀錄
    expect(fresh.status).toBe('CANCELLED')
    expect(fresh.payment?.status).toBe('PAID')
    expect(fresh.payment?.failReason).toContain('逾期入帳')
    expect(fresh.payment?.paidAt).not.toBeNull()

    const event = await db.webhookEvent.findFirstOrThrow({
      where: { kind: 'payment_return', merchantTradeNo: order.orderNo },
    })
    expect(event.processedAt).not.toBeNull()
  })
})

describe('POST /api/ecpay/payment/info', () => {
  it('ATM 取號成功：回 1|OK、payment 轉 AWAITING_TRANSFER 並存繳費資訊、寄取號通知信', async () => {
    const { order } = await createTestOrder({ choosePayment: 'ATM' })
    const params = signedPaymentInfoParams(order)

    const res = await paymentInfo(callbackRequest('/api/ecpay/payment/info', params))

    expect(await res.text()).toBe('1|OK')

    const fresh = await reloadOrder(order.id)
    expect(fresh.payment?.status).toBe('AWAITING_TRANSFER')
    expect(fresh.payment?.bankCode).toBe('812')
    expect(fresh.payment?.vAccount).toBe('9990012345678901')
    expect(fresh.payment?.expireDate).toBe('2026/12/31')

    const event = await db.webhookEvent.findFirstOrThrow({
      where: { kind: 'payment_info', merchantTradeNo: order.orderNo },
    })
    expect(event.processedAt).not.toBeNull()

    expect(enqueueMock).toHaveBeenCalledWith('send-email', {
      template: 'payment-info',
      orderId: order.id,
    })
  })
})

/**
 * B-08：前台導回（OrderResultURL）絕對不能改變付款狀態。
 *
 * 綠界用兩條路通知結果：ReturnURL 是伺服器對伺服器、帶簽章、可信；
 * OrderResultURL 是「叫消費者的瀏覽器把結果轉交給我們」，資料經過使用者的
 * 電腦，任何人都能偽造。在這支端點改訂單狀態＝任何人都能免費下單。
 *
 * 這支目前的實作只做一件事：303 導向結果頁，連資料庫都沒碰。這一組是
 * **回歸測試** —— 它看起來太像「應該順手在這裡更新訂單」的地方，是重構時
 * 最容易被誤傷的檔案之一。
 */
describe('POST /api/ecpay/payment/result（前台導回）', () => {
  it('偽造的「付款成功」表單：訂單狀態完全不變、不落事件、不排任何後續工作', async () => {
    const { order, variant } = await createTestOrder()
    const before = await orderFingerprint(order.id)

    // 連簽章都不對的低成本攻擊：隨手拼一份看起來成功的表單
    const forged = {
      MerchantTradeNo: order.payment?.merchantTradeNo ?? '',
      RtnCode: '1',
      RtnMsg: '交易成功',
      TradeAmt: String(order.grandTotal),
      TradeNo: 'FORGED0001',
      PaymentDate: '2026/08/16 10:00:00',
      PaymentType: 'Credit_CreditCard',
      CheckMacValue: '0'.repeat(64),
    }

    const res = await paymentResult(callbackRequest('/api/ecpay/payment/result', forged))

    expect(res.status).toBe(303)
    expect(await orderFingerprint(order.id)).toEqual(before)

    // 沒有任何副作用：不寫事件、不動庫存、不寄信、不建物流單
    expect(await db.webhookEvent.count()).toBe(0)
    const freshVariant = await db.productVariant.findUniqueOrThrow({ where: { id: variant.id } })
    expect(freshVariant.stock).toBe(10)
    expect(freshVariant.reservedStock).toBe(1)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('就算簽章是真的（重放一份合法的 ReturnURL 內容）也一樣不改狀態', async () => {
    const { order } = await createTestOrder()
    const before = await orderFingerprint(order.id)

    // 最強的攻擊：消費者確實刷了另一筆、手上有一份簽章正確的 payload，
    // 把它往這支端點送。權威只有 ReturnURL，這裡照樣什麼都不做。
    const authentic = signedPaymentReturnParams(order)

    const res = await paymentResult(callbackRequest('/api/ecpay/payment/result', authentic))

    expect(res.status).toBe(303)
    expect(await orderFingerprint(order.id)).toEqual(before)
    expect(await db.webhookEvent.count()).toBe(0)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('把使用者導到結果頁並帶上訂單編號（303 讓瀏覽器把 POST 轉成 GET）', async () => {
    const { order } = await createTestOrder()
    const params = signedPaymentReturnParams(order)

    const res = await paymentResult(callbackRequest('/api/ecpay/payment/result', params))

    expect(res.status).toBe(303)
    const location = new URL(res.headers.get('location') ?? '')
    expect(location.pathname).toBe('/checkout/result')
    expect(location.searchParams.get('orderNo')).toBe(order.payment?.merchantTradeNo)
  })

  it('沒有 MerchantTradeNo 也不會炸，只是導向不帶訂單編號的結果頁', async () => {
    const res = await paymentResult(callbackRequest('/api/ecpay/payment/result', { RtnCode: '1' }))

    expect(res.status).toBe(303)
    const location = new URL(res.headers.get('location') ?? '')
    expect(location.pathname).toBe('/checkout/result')
    expect(location.searchParams.has('orderNo')).toBe(false)
  })

  it('使用者按上一頁變成 GET：同樣只導向，不動任何資料', async () => {
    const { order } = await createTestOrder()
    const before = await orderFingerprint(order.id)
    const orderNo = order.payment?.merchantTradeNo ?? ''

    // GET 分支讀的是 req.nextUrl（NextRequest 才有的屬性），
    // 所以這裡要用 Next 實際會傳進來的型別，不能用普通的 Request。
    const res = await paymentResultView(
      new NextRequest(`http://localhost:3000/api/ecpay/payment/result?orderNo=${orderNo}`),
    )

    expect(res.status).toBe(303)
    expect(await orderFingerprint(order.id)).toEqual(before)
    expect(await db.webhookEvent.count()).toBe(0)
  })
})

describe('POST /api/ecpay/logistics/reply', () => {
  it('簽章正確（MD5 + 物流憑證）的物流回拋：更新 shipment、寫入狀態 log、回 1|OK', async () => {
    const { order } = await createTestOrder({
      status: 'PROCESSING',
      shipmentStatus: 'CREATED',
      shipmentOverrides: { allPayLogisticsId: 'ALP0001' },
    })

    const params = signedLogisticsParams({
      MerchantID: env.ECPAY_LOGISTICS_MERCHANT_ID,
      MerchantTradeNo: `${order.orderNo}L`,
      AllPayLogisticsID: 'ALP0001',
      LogisticsType: 'CVS',
      LogisticsSubType: 'UNIMARTC2C',
      GoodsAmount: String(order.grandTotal),
      RtnCode: '2030',
      RtnMsg: '貨件已出貨',
      UpdateStatusDate: '2026/08/15 10:00:00',
    })

    const res = await logisticsReply(callbackRequest('/api/ecpay/logistics/reply', params))

    expect(await res.text()).toBe('1|OK')

    const fresh = await reloadOrder(order.id)
    expect(fresh.shipment?.status).toBe('IN_TRANSIT')
    expect(fresh.shipment?.statusCode).toBe('2030')
    expect(fresh.shipment?.statusMsg).toBe('貨件已出貨')

    expect(fresh.shipment?.logs).toHaveLength(1)
    expect(fresh.shipment?.logs[0]?.statusCode).toBe('2030')
    expect(fresh.shipment?.logs[0]?.message).toBe('貨件已出貨')

    // IN_TRANSIT 帶動訂單 → SHIPPED，並寄出貨通知
    expect(fresh.status).toBe('SHIPPED')
    expect(enqueueMock).toHaveBeenCalledWith('send-email', {
      template: 'shipped',
      orderId: order.id,
    })

    const event = await db.webhookEvent.findFirstOrThrow({ where: { kind: 'logistics_reply' } })
    expect(event.signatureValid).toBe(true)
    expect(event.processedAt).not.toBeNull()
  })
})
