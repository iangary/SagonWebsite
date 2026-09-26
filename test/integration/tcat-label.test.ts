import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { createTestOrder, reloadOrder } from '../factories'

vi.mock('@/lib/tcat/client', () => ({
  TcatApiError: class TcatApiError extends Error {},
  parsingAddress: vi.fn(),
  printObt: vi.fn(),
  downloadObt: vi.fn(),
  callPickup: vi.fn(),
  queryObtStatus: vi.fn(),
}))

// 避免測試往 storage/labels 寫真實檔案
vi.mock('@/lib/tcat/labels', () => ({
  saveLabel: vi.fn(),
  readLabel: vi.fn(),
}))

import { downloadObt } from '@/lib/tcat/client'
import { saveLabel } from '@/lib/tcat/labels'
import { labelAvailability, LABEL_FILENO_TTL_MS, redownloadTcatLabel } from '@/lib/orders/tcat-label'

const downloadObtMock = vi.mocked(downloadObt)
const saveLabelMock = vi.mocked(saveLabel)

const HOURS = 60 * 60 * 1000

beforeEach(() => {
  vi.resetAllMocks()
  downloadObtMock.mockResolvedValue(Buffer.from('%PDF-1.4'))
  saveLabelMock.mockImplementation(async (orderNo) => `${orderNo}.pdf`)
})

async function makeTcatOrder(shipmentOverrides: Record<string, unknown>) {
  const { order } = await createTestOrder({
    shippingMethod: 'HOME',
    status: 'PROCESSING',
    withReservations: false,
    shipmentStatus: 'CREATED',
    shipmentOverrides: { shipmentNo: '903402901971', ...shipmentOverrides },
  })
  return order
}

describe('labelAvailability', () => {
  const base = { shipmentNo: 'OBT1', labelPath: null, labelFileNo: 'F1', labelFileNoIssuedAt: new Date() }

  it('依序判斷：沒單號 → 已存檔 → 沒下載編號 → 過期與否', () => {
    const now = new Date()
    expect(labelAvailability({ ...base, shipmentNo: null }, now)).toBe('none')
    expect(labelAvailability({ ...base, labelPath: 'x.pdf' }, now)).toBe('ready')
    expect(labelAvailability({ ...base, labelFileNo: null }, now)).toBe('external')
    expect(labelAvailability(base, now)).toBe('downloadable')
    expect(
      labelAvailability(base, new Date(base.labelFileNoIssuedAt.getTime() + LABEL_FILENO_TTL_MS)),
    ).toBe('expired')
  })
})

describe('redownloadTcatLabel', () => {
  it('24 小時內：只抓這一張、存檔、清掉「PDF 沒抓到」的警告', async () => {
    const order = await makeTcatOrder({
      labelFileNo: 'FILE0001',
      labelFileNoIssuedAt: new Date(Date.now() - 2 * HOURS),
      failReason: '託運單已成立，但 PDF 下載失敗',
    })

    await redownloadTcatLabel(order.id)

    expect(downloadObtMock).toHaveBeenCalledWith('FILE0001', ['903402901971'])
    expect(saveLabelMock).toHaveBeenCalledWith(order.orderNo, expect.any(Buffer))
    const fresh = await reloadOrder(order.id)
    expect(fresh.shipment?.labelPath).toBe(`${order.orderNo}.pdf`)
    expect(fresh.shipment?.labelDownloadedAt).not.toBeNull()
    expect(fresh.shipment?.failReason).toBeNull()
  })

  it('超過 24 小時：不打黑貓，請人從黑貓系統列印', async () => {
    const order = await makeTcatOrder({
      labelFileNo: 'FILE0001',
      labelFileNoIssuedAt: new Date(Date.now() - 25 * HOURS),
    })

    await expect(redownloadTcatLabel(order.id)).rejects.toThrow(/24 小時/)
    expect(downloadObtMock).not.toHaveBeenCalled()
  })

  it('人工在黑貓系統建的單（沒有下載編號）：擋下來並說明原因', async () => {
    const order = await makeTcatOrder({ labelFileNo: null })

    await expect(redownloadTcatLabel(order.id)).rejects.toThrow(/不是由網站建立/)
    expect(downloadObtMock).not.toHaveBeenCalled()
  })

  it('黑貓下載失敗：錯誤往外丟，資料庫不動', async () => {
    const order = await makeTcatOrder({
      labelFileNo: 'FILE0001',
      labelFileNoIssuedAt: new Date(),
    })
    downloadObtMock.mockRejectedValue(new Error('黑貓 DownloadOBT：超過列印截止時間'))

    await expect(redownloadTcatLabel(order.id)).rejects.toThrow(/超過列印截止時間/)
    const fresh = await db.shipment.findUniqueOrThrow({ where: { orderId: order.id } })
    expect(fresh.labelPath).toBeNull()
  })
})
