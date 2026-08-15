import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { createTestOrder, reloadOrder } from '../factories'
import { enqueueMock } from './mocks'

vi.mock('@/lib/queue', async () => (await import('./mocks')).queueMockModule())

// 只 mock 對外的 HTTP（createShipment），isC2C / mapLogisticsStatus 等純函式保持真實
vi.mock('@/lib/ecpay/logistics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ecpay/logistics')>()
  return { ...actual, createShipment: vi.fn() }
})

// 黑貓整個 client 都是 HTTP，全部 mock（鏡射真實的具名匯出）
vi.mock('@/lib/tcat/client', () => ({
  TcatApiError: class TcatApiError extends Error {},
  parsingAddress: vi.fn(),
  printObt: vi.fn(),
  downloadObt: vi.fn(),
  queryObtStatus: vi.fn(),
}))

// 避免測試往 storage/labels 寫真實檔案
vi.mock('@/lib/tcat/labels', () => ({
  saveLabel: vi.fn(),
  readLabel: vi.fn(),
}))

import { createShipment } from '@/lib/ecpay/logistics'
import { downloadObt, parsingAddress, printObt } from '@/lib/tcat/client'
import { saveLabel } from '@/lib/tcat/labels'
import {
  advanceOrderForShipmentStatus,
  createShipmentForOrder,
  handleLogisticsReply,
} from '@/lib/orders/logistics'

const createShipmentMock = vi.mocked(createShipment)
const parsingAddressMock = vi.mocked(parsingAddress)
const printObtMock = vi.mocked(printObt)
const downloadObtMock = vi.mocked(downloadObt)
const saveLabelMock = vi.mocked(saveLabel)

const HOME_ADDRESS = '台北市中山區測試路 1 號'

beforeEach(() => {
  vi.resetAllMocks()
})

// ---------------------------------------------------------------------------
// CVS（綠界超商取貨）
// ---------------------------------------------------------------------------

describe('createShipmentForOrder — 綠界超商取貨', () => {
  it('happy path：呼叫綠界建單並把單號寫回 shipment，訂單 PAID → PROCESSING', async () => {
    const { order } = await createTestOrder({ status: 'PAID', paymentStatus: 'PAID' })
    createShipmentMock.mockResolvedValue({
      ok: true,
      allPayLogisticsId: '10000001',
      shipmentNo: 'C2C9999',
      cvsValidationNo: '1234',
      raw: { AllPayLogisticsID: '10000001' },
    })

    await createShipmentForOrder(order.id)

    expect(createShipmentMock).toHaveBeenCalledTimes(1)
    expect(createShipmentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        // 物流編號 = 金流編號 + L 後綴
        merchantTradeNo: `${order.orderNo}L`,
        subType: 'UNIMARTC2C',
        goodsAmount: order.grandTotal,
        receiverStoreId: '131386',
      }),
    )

    const fresh = await reloadOrder(order.id)
    expect(fresh.shipment?.status).toBe('CREATED')
    expect(fresh.shipment?.allPayLogisticsId).toBe('10000001')
    expect(fresh.shipment?.shipmentNo).toBe('C2C9999')
    expect(fresh.shipment?.cvsValidationNo).toBe('1234')
    expect(fresh.status).toBe('PROCESSING')
  })

  it('綠界回 ok:false：shipment 標 FAILED 記 failReason，並 throw 讓 BullMQ 重試', async () => {
    const { order } = await createTestOrder({ status: 'PAID' })
    createShipmentMock.mockResolvedValue({
      ok: false,
      raw: { body: '0|10500040' },
      error: '10500040 GoodsAmount 超出範圍',
    })

    await expect(createShipmentForOrder(order.id)).rejects.toThrow('建立物流訂單失敗')

    const fresh = await reloadOrder(order.id)
    expect(fresh.shipment?.status).toBe('FAILED')
    expect(fresh.shipment?.failReason).toContain('10500040')
  })

  it('金額超過 20000 上限：不打 HTTP、轉人工（statusMsg 說明）、不 throw', async () => {
    // 25000 + 60 運費 = 25060 > GOODS_AMOUNT_MAX(20000)
    const { order } = await createTestOrder({ status: 'PAID', unitPrice: 25000 })

    await expect(createShipmentForOrder(order.id)).resolves.toBeUndefined()

    expect(createShipmentMock).not.toHaveBeenCalled()
    const fresh = await reloadOrder(order.id)
    expect(fresh.shipment?.status).toBe('PENDING')
    expect(fresh.shipment?.statusMsg).toContain('超出綠界超商取貨的 1~20000 元限制')
    // 已付款仍要進備貨流程，只是出貨方式要人工另想辦法
    expect(fresh.status).toBe('PROCESSING')
  })

  it('缺門市代號：直接 throw，不打綠界', async () => {
    const { order } = await createTestOrder({
      status: 'PAID',
      shipmentOverrides: { cvsStoreId: null },
    })

    await expect(createShipmentForOrder(order.id)).rejects.toThrow('超商取貨缺少門市代號')
    expect(createShipmentMock).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// 冪等與前置守衛
// ---------------------------------------------------------------------------

describe('createShipmentForOrder — 守衛', () => {
  it('shipmentNo 已存在：直接 return，不再打任何 provider', async () => {
    const { order } = await createTestOrder({
      status: 'PAID',
      shipmentOverrides: { shipmentNo: 'ALREADY1' },
    })

    await expect(createShipmentForOrder(order.id)).resolves.toBeUndefined()

    expect(createShipmentMock).not.toHaveBeenCalled()
    expect(parsingAddressMock).not.toHaveBeenCalled()
    const fresh = await reloadOrder(order.id)
    expect(fresh.shipment?.shipmentNo).toBe('ALREADY1')
  })

  it('allPayLogisticsId 已存在：同樣跳過', async () => {
    const { order } = await createTestOrder({
      status: 'PAID',
      shipmentOverrides: { allPayLogisticsId: 'ALP-DONE' },
    })

    await expect(createShipmentForOrder(order.id)).resolves.toBeUndefined()
    expect(createShipmentMock).not.toHaveBeenCalled()
  })

  it('CANCELLED / REFUNDED 訂單：跳過不建單', async () => {
    const { order: cancelled } = await createTestOrder({ status: 'CANCELLED' })
    const { order: refunded } = await createTestOrder({ status: 'REFUNDED' })

    await expect(createShipmentForOrder(cancelled.id)).resolves.toBeUndefined()
    await expect(createShipmentForOrder(refunded.id)).resolves.toBeUndefined()

    expect(createShipmentMock).not.toHaveBeenCalled()
    expect((await reloadOrder(cancelled.id)).shipment?.status).toBe('PENDING')
  })

  it('找不到訂單或沒有 shipment 關聯：throw', async () => {
    await expect(createShipmentForOrder('no-such-order')).rejects.toThrow('訂單沒有物流資料')
  })
})

// ---------------------------------------------------------------------------
// HOME（黑貓宅急便）
// ---------------------------------------------------------------------------

function mockTcatHappyPath(orderNo: string, obtNumber = '903402901971') {
  parsingAddressMock.mockResolvedValue(new Map([[HOME_ADDRESS, '71-802-24-B']]))
  printObtMock.mockResolvedValue({
    obtNumbers: new Map([[orderNo, obtNumber]]),
    fileNo: 'FILE0001',
    printDateTime: '2026/08/15 10:00:00',
    raw: { IsOK: 'Y' },
  })
  downloadObtMock.mockResolvedValue(Buffer.from('%PDF-fake'))
  saveLabelMock.mockResolvedValue(`${orderNo}.pdf`)
}

describe('createShipmentForOrder — 黑貓宅配', () => {
  it('happy path：查郵碼 → 建單 → 抓 PDF，shipment CREATED + 託運單號 + 標籤路徑', async () => {
    const { order } = await createTestOrder({ shippingMethod: 'HOME', status: 'PAID' })
    mockTcatHappyPath(order.orderNo)

    await createShipmentForOrder(order.id)

    expect(parsingAddressMock).toHaveBeenCalledTimes(1)
    expect(printObtMock).toHaveBeenCalledTimes(1)
    // 電文細節由 unit test 顧，這裡只驗 OrderId 有對回我們的訂單編號
    const sentOrders = printObtMock.mock.calls[0]![0]
    expect(sentOrders).toHaveLength(1)
    expect(sentOrders[0]!.OrderId).toBe(order.orderNo)
    expect(downloadObtMock).toHaveBeenCalledWith('FILE0001')
    expect(saveLabelMock).toHaveBeenCalledWith(order.orderNo, expect.any(Buffer))

    const fresh = await reloadOrder(order.id)
    expect(fresh.shipment?.status).toBe('CREATED')
    expect(fresh.shipment?.shipmentNo).toBe('903402901971')
    expect(fresh.shipment?.labelPath).toBe(`${order.orderNo}.pdf`)
    expect(fresh.shipment?.labelDownloadedAt).not.toBeNull()
    expect(fresh.shipment?.failReason).toBeNull()
    expect(fresh.status).toBe('PROCESSING')
  })

  it('沒有收件地址：轉人工，不打黑貓', async () => {
    const { order } = await createTestOrder({
      shippingMethod: 'HOME',
      status: 'PAID',
      shipmentOverrides: { receiverAddress: null },
    })

    await expect(createShipmentForOrder(order.id)).resolves.toBeUndefined()

    expect(parsingAddressMock).not.toHaveBeenCalled()
    const fresh = await reloadOrder(order.id)
    expect(fresh.shipment?.status).toBe('PENDING')
    expect(fresh.shipment?.statusMsg).toContain('沒有收件地址')
  })

  it('地址換不到配送郵碼（回 X）：轉人工，不呼叫 printObt', async () => {
    const { order } = await createTestOrder({ shippingMethod: 'HOME', status: 'PAID' })
    parsingAddressMock.mockResolvedValue(new Map([[HOME_ADDRESS, 'X']]))

    await expect(createShipmentForOrder(order.id)).resolves.toBeUndefined()

    expect(printObtMock).not.toHaveBeenCalled()
    const fresh = await reloadOrder(order.id)
    expect(fresh.shipment?.status).toBe('PENDING')
    expect(fresh.shipment?.statusMsg).toContain('黑貓查無此地址')
  })

  it('訂單資料不合黑貓規格（電話手機都無效）：轉人工並帶原因', async () => {
    const { order } = await createTestOrder({
      shippingMethod: 'HOME',
      status: 'PAID',
      shipmentOverrides: { receiverCell: '12345', receiverPhone: null },
    })
    parsingAddressMock.mockResolvedValue(new Map([[HOME_ADDRESS, '71-802-24-B']]))

    await expect(createShipmentForOrder(order.id)).resolves.toBeUndefined()

    expect(printObtMock).not.toHaveBeenCalled()
    const fresh = await reloadOrder(order.id)
    expect(fresh.shipment?.status).toBe('PENDING')
    expect(fresh.shipment?.statusMsg).toContain('不符合黑貓規格')
  })

  it('printObt 逾時 reject：絕不 throw（防止 BullMQ 重試建出第二張單）、恰呼叫一次、提示先到黑貓後台確認', async () => {
    const { order } = await createTestOrder({ shippingMethod: 'HOME', status: 'PAID' })
    parsingAddressMock.mockResolvedValue(new Map([[HOME_ADDRESS, '71-802-24-B']]))
    printObtMock.mockRejectedValue(new Error('fetch timeout'))

    await expect(createShipmentForOrder(order.id)).resolves.toBeUndefined()

    expect(printObtMock).toHaveBeenCalledTimes(1)
    const fresh = await reloadOrder(order.id)
    expect(fresh.shipment?.status).toBe('PENDING')
    expect(fresh.shipment?.statusMsg).toContain('黑貓建單未回覆成功')
    expect(fresh.shipment?.statusMsg).toContain('確認')
    expect(fresh.shipment?.shipmentNo).toBeNull()
  })

  it('printObt 成功但回應裡沒有本單的託運單號：轉人工', async () => {
    const { order } = await createTestOrder({ shippingMethod: 'HOME', status: 'PAID' })
    parsingAddressMock.mockResolvedValue(new Map([[HOME_ADDRESS, '71-802-24-B']]))
    printObtMock.mockResolvedValue({
      obtNumbers: new Map(), // 沒有任何配號
      fileNo: 'FILE0002',
      printDateTime: '2026/08/15 10:00:00',
      raw: { IsOK: 'Y' },
    })

    await expect(createShipmentForOrder(order.id)).resolves.toBeUndefined()

    const fresh = await reloadOrder(order.id)
    expect(fresh.shipment?.status).toBe('PENDING')
    expect(fresh.shipment?.statusMsg).toContain('沒有託運單號')
  })

  it('downloadObt 失敗：託運單已成立所以 shipment 仍 CREATED，failReason 留標籤警告、不 throw', async () => {
    const { order } = await createTestOrder({ shippingMethod: 'HOME', status: 'PAID' })
    mockTcatHappyPath(order.orderNo)
    downloadObtMock.mockRejectedValue(new Error('HTTP 500'))

    await expect(createShipmentForOrder(order.id)).resolves.toBeUndefined()

    expect(saveLabelMock).not.toHaveBeenCalled()
    const fresh = await reloadOrder(order.id)
    expect(fresh.shipment?.status).toBe('CREATED')
    expect(fresh.shipment?.shipmentNo).toBe('903402901971')
    expect(fresh.shipment?.labelPath).toBeNull()
    expect(fresh.shipment?.failReason).toContain('PDF 下載失敗')
  })
})

// ---------------------------------------------------------------------------
// handleLogisticsReply（綠界狀態回拋）
// ---------------------------------------------------------------------------

describe('handleLogisticsReply', () => {
  it('寫入 LogisticsStatusLog 並同步 statusCode / statusMsg / 映射後的 status', async () => {
    const { order } = await createTestOrder({
      status: 'PROCESSING',
      shipmentStatus: 'CREATED',
      shipmentOverrides: { allPayLogisticsId: 'ALP1616', shipmentNo: 'C2C1616' },
    })

    await handleLogisticsReply({
      AllPayLogisticsID: 'ALP1616',
      MerchantTradeNo: `${order.orderNo}L`,
      RtnCode: '2063',
      RtnMsg: '送達門市',
      UpdateStatusDate: '2026/08/15 12:00:00',
    })

    const fresh = await reloadOrder(order.id)
    expect(fresh.shipment?.status).toBe('ARRIVED')
    expect(fresh.shipment?.statusCode).toBe('2063')
    expect(fresh.shipment?.statusMsg).toBe('送達門市')

    expect(fresh.shipment?.logs).toHaveLength(1)
    const log = fresh.shipment!.logs[0]!
    expect(log.statusCode).toBe('2063')
    expect(log.message).toBe('送達門市')
    // UpdateStatusDate 是台北時間，要以 +08:00 解析
    expect(log.occurredAt.toISOString()).toBe('2026-08-15T04:00:00.000Z')
  })

  it('首次回拋比 Create 回應先到：用 MerchantTradeNo 找到單並回填 allPayLogisticsId 與 shipmentNo', async () => {
    const { order } = await createTestOrder({ status: 'PAID', shipmentStatus: 'PENDING' })

    await handleLogisticsReply({
      AllPayLogisticsID: 'ALP1717',
      MerchantTradeNo: `${order.orderNo}L`, // 物流編號 = 金流編號 + L
      RtnCode: '300',
      RtnMsg: '訂單處理中(已收到訂單資料)',
      CVSPaymentNo: 'CPN1717',
      UpdateStatusDate: '2026/08/15 09:00:00',
    })

    const fresh = await reloadOrder(order.id)
    expect(fresh.shipment?.allPayLogisticsId).toBe('ALP1717')
    expect(fresh.shipment?.shipmentNo).toBe('CPN1717')
    expect(fresh.shipment?.status).toBe('CREATED')
  })

  it('AllPayLogisticsID 與 MerchantTradeNo 都對不到任何單：throw', async () => {
    await expect(
      handleLogisticsReply({
        AllPayLogisticsID: 'NOPE',
        MerchantTradeNo: 'NOSUCHORDERL',
        RtnCode: '300',
        RtnMsg: 'x',
      }),
    ).rejects.toThrow('找不到對應的物流單')
  })
})

// ---------------------------------------------------------------------------
// advanceOrderForShipmentStatus（物流狀態帶動訂單狀態）
// ---------------------------------------------------------------------------

describe('advanceOrderForShipmentStatus', () => {
  it('IN_TRANSIT / ARRIVED → 訂單 SHIPPED 並寄出貨通知；PICKED_UP → COMPLETED', async () => {
    const { order: a } = await createTestOrder({ status: 'PROCESSING' })
    await advanceOrderForShipmentStatus(a.id, 'IN_TRANSIT')
    expect((await reloadOrder(a.id)).status).toBe('SHIPPED')
    expect(enqueueMock).toHaveBeenCalledWith('send-email', {
      template: 'shipped',
      orderId: a.id,
    })

    const { order: b } = await createTestOrder({ status: 'SHIPPED' })
    await advanceOrderForShipmentStatus(b.id, 'ARRIVED')
    // 已經是 SHIPPED 就不重複更新也不重寄信
    expect((await reloadOrder(b.id)).status).toBe('SHIPPED')
    expect(enqueueMock).toHaveBeenCalledTimes(1)

    const { order: c } = await createTestOrder({ status: 'SHIPPED' })
    await advanceOrderForShipmentStatus(c.id, 'PICKED_UP')
    expect((await reloadOrder(c.id)).status).toBe('COMPLETED')
    // 取貨完成不寄信（目前沒有這個範本）
    expect(enqueueMock).toHaveBeenCalledTimes(1)
  })

  it('不倒退：COMPLETED 的訂單收到 IN_TRANSIT 仍是 COMPLETED，也不重寄信', async () => {
    const { order } = await createTestOrder({ status: 'COMPLETED' })

    await advanceOrderForShipmentStatus(order.id, 'IN_TRANSIT')

    expect((await reloadOrder(order.id)).status).toBe('COMPLETED')
    expect(enqueueMock).not.toHaveBeenCalled()
  })
})
