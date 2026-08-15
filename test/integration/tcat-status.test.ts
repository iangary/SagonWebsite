import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrderStatus, ProductVariant, ShipmentStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { createTestOrder, createTestProduct, reloadOrder } from '../factories'
import { enqueueMock } from './mocks'

vi.mock('@/lib/queue', async () => (await import('./mocks')).queueMockModule())

vi.mock('@/lib/tcat/client', () => ({
  TcatApiError: class TcatApiError extends Error {},
  parsingAddress: vi.fn(),
  printObt: vi.fn(),
  downloadObt: vi.fn(),
  queryObtStatus: vi.fn(),
}))

import { queryObtStatus, type TcatObtStatus } from '@/lib/tcat/client'
import { pollTcatShipmentStatuses } from '@/lib/orders/tcat-status'

const queryObtStatusMock = vi.mocked(queryObtStatus)

/** 黑貓限制同一單 2 小時只能查一次；輪詢用這個間隔篩選 */
const HOURS = 60 * 60 * 1000

let sharedVariant: ProductVariant
let obtSeq = 0

beforeEach(async () => {
  vi.resetAllMocks()
  queryObtStatusMock.mockResolvedValue([])
  const { variants } = await createTestProduct({ stock: 100 })
  sharedVariant = variants[0]!
})

/** 建一張黑貓宅配單（共用同一個商品變體，避免每張單都建一個商品） */
async function makeTcatShipment(
  input: {
    shipmentNo?: string | null
    shipmentStatus?: ShipmentStatus
    orderStatus?: OrderStatus
    statusPolledAt?: Date | null
  } = {},
) {
  obtSeq += 1
  const { order } = await createTestOrder({
    variant: sharedVariant,
    withReservations: false,
    shippingMethod: 'HOME',
    status: input.orderStatus ?? 'PROCESSING',
    shipmentStatus: input.shipmentStatus ?? 'CREATED',
    shipmentOverrides: {
      shipmentNo: input.shipmentNo === undefined ? `OBT${String(obtSeq).padStart(4, '0')}` : input.shipmentNo,
      ...(input.statusPolledAt !== undefined ? { statusPolledAt: input.statusPolledAt } : {}),
    },
  })
  return order
}

function obtStatus(obtNumber: string, overrides: Partial<TcatObtStatus> = {}): TcatObtStatus {
  return {
    OBTNumber: obtNumber,
    OrderId: 'ORDER',
    StationName: '台北營業所',
    CreateDateTime: '20260815100000',
    CustomerId: '1265635401',
    StatusId: '151',
    StatusName: '配送中',
    StatusList: [
      {
        StatusId: '151',
        StatusName: '配送中',
        CreateDateTime: '20260815100000',
        StationName: '台北營業所',
      },
    ],
    ...overrides,
  }
}

describe('pollTcatShipmentStatuses', () => {
  it('沒有符合條件的 shipment：完全不打黑貓', async () => {
    const result = await pollTcatShipmentStatuses()

    expect(result).toEqual({ polled: 0, logsCreated: 0, statusChanged: 0 })
    expect(queryObtStatusMock).not.toHaveBeenCalled()
  })

  it('只挑 TCAT、有託運單號、且狀態還在路上（CREATED/IN_TRANSIT/ARRIVED）的單', async () => {
    // CVS 單有 shipmentNo 也不該被查
    await createTestOrder({
      variant: sharedVariant,
      withReservations: false,
      shippingMethod: 'CVS',
      shipmentStatus: 'CREATED',
      shipmentOverrides: { shipmentNo: 'CVSNO1' },
    })
    await makeTcatShipment({ shipmentNo: null }) // 還沒配號
    await makeTcatShipment({ shipmentStatus: 'PICKED_UP', shipmentNo: 'OBT-DONE' }) // 已取貨
    await makeTcatShipment({ shipmentStatus: 'RETURNED', shipmentNo: 'OBT-BACK' }) // 已退貨
    await makeTcatShipment({ shipmentNo: 'OBT-GO', shipmentStatus: 'IN_TRANSIT' })

    const result = await pollTcatShipmentStatuses()

    expect(result.polled).toBe(1)
    expect(queryObtStatusMock).toHaveBeenCalledTimes(1)
    expect(queryObtStatusMock).toHaveBeenCalledWith(['OBT-GO'])
  })

  it('2 小時內查過的跳過；沒查過的（statusPolledAt=null）排最前面', async () => {
    await makeTcatShipment({
      shipmentNo: 'OBT-RECENT',
      statusPolledAt: new Date(Date.now() - 1 * HOURS),
    })
    await makeTcatShipment({
      shipmentNo: 'OBT-STALE',
      statusPolledAt: new Date(Date.now() - 3 * HOURS),
    })
    await makeTcatShipment({ shipmentNo: 'OBT-NEVER', statusPolledAt: null })

    await pollTcatShipmentStatuses()

    const queried = queryObtStatusMock.mock.calls[0]![0]
    expect(queried).toEqual(['OBT-NEVER', 'OBT-STALE'])
    expect(queried).not.toContain('OBT-RECENT')
  })

  it('一批最多 10 筆（黑貓 API 上限）：12 張待查只查 10 張', async () => {
    for (let i = 0; i < 12; i += 1) {
      await makeTcatShipment()
    }

    const result = await pollTcatShipmentStatuses()

    expect(result.polled).toBe(10)
    expect(queryObtStatusMock.mock.calls[0]![0]).toHaveLength(10)
  })

  it('statusPolledAt 整批寫入，即使黑貓沒回某張單的貨態（避免下一輪重查浪費配額）', async () => {
    const a = await makeTcatShipment({ shipmentNo: 'OBT-HASDATA' })
    const b = await makeTcatShipment({ shipmentNo: 'OBT-NODATA' })
    // 只有其中一張回得出貨態（剛建單還沒集貨的常態）
    queryObtStatusMock.mockResolvedValue([obtStatus('OBT-HASDATA')])

    await pollTcatShipmentStatuses()

    const shipments = await db.shipment.findMany({
      where: { orderId: { in: [a.id, b.id] } },
    })
    expect(shipments).toHaveLength(2)
    for (const s of shipments) {
      expect(s.statusPolledAt).not.toBeNull()
    }
  })

  it('貨態映射：151 配送中 → IN_TRANSIT + 訂單 SHIPPED；301 配完 → PICKED_UP + 訂單 COMPLETED', async () => {
    const transit = await makeTcatShipment({ shipmentNo: 'OBT-T' })
    const done = await makeTcatShipment({ shipmentNo: 'OBT-D', shipmentStatus: 'IN_TRANSIT' })
    queryObtStatusMock.mockResolvedValue([
      obtStatus('OBT-T', { StatusId: '151', StatusName: '配送中' }),
      obtStatus('OBT-D', {
        StatusId: '301',
        StatusName: '配完',
        StatusList: [
          { StatusId: '301', StatusName: '配完', CreateDateTime: '20260815110000', StationName: '台北營業所' },
        ],
      }),
    ])

    const result = await pollTcatShipmentStatuses()

    expect(result.statusChanged).toBe(2)

    const freshTransit = await reloadOrder(transit.id)
    expect(freshTransit.shipment?.status).toBe('IN_TRANSIT')
    expect(freshTransit.status).toBe('SHIPPED')
    expect(enqueueMock).toHaveBeenCalledWith('send-email', {
      template: 'shipped',
      orderId: transit.id,
    })

    const freshDone = await reloadOrder(done.id)
    expect(freshDone.shipment?.status).toBe('PICKED_UP')
    expect(freshDone.status).toBe('COMPLETED')
  })

  it('未知的 StatusId：更新 statusCode / statusMsg 但不動 status（官方碼表本來就不齊）', async () => {
    const order = await makeTcatShipment({ shipmentNo: 'OBT-U' })
    // 100「已集貨」出現在規格書範例但不在附錄一的碼表裡
    queryObtStatusMock.mockResolvedValue([
      obtStatus('OBT-U', {
        StatusId: '100',
        StatusName: '已集貨',
        StatusList: [
          { StatusId: '100', StatusName: '已集貨', CreateDateTime: '20260815090000', StationName: '台北營業所' },
        ],
      }),
    ])

    const result = await pollTcatShipmentStatuses()

    expect(result.statusChanged).toBe(0)
    const fresh = await reloadOrder(order.id)
    expect(fresh.shipment?.statusCode).toBe('100')
    expect(fresh.shipment?.statusMsg).toBe('已集貨')
    expect(fresh.shipment?.status).toBe('CREATED') // 不變
    expect(fresh.status).toBe('PROCESSING')
  })

  it('recordStatusHistory 去重：同樣的 StatusList 輪詢兩次不重複寫 log，新事件才追加', async () => {
    const order = await makeTcatShipment({ shipmentNo: 'OBT-H' })
    const firstList = [
      { StatusId: '151', StatusName: '配送中', CreateDateTime: '20260815100000', StationName: '台北營業所' },
    ]
    queryObtStatusMock.mockResolvedValue([
      obtStatus('OBT-H', { StatusId: '151', StatusName: '配送中', StatusList: firstList }),
    ])

    const first = await pollTcatShipmentStatuses()
    expect(first.logsCreated).toBe(1)

    // 剛查完 statusPolledAt 是現在，要手動回撥才會再被選進下一批
    const shipment = await db.shipment.findUniqueOrThrow({ where: { orderId: order.id } })
    await db.shipment.update({
      where: { id: shipment.id },
      data: { statusPolledAt: new Date(Date.now() - 3 * HOURS) },
    })

    // 第二輪：黑貓回一模一樣的完整歷程 → 不該新增任何 log
    const second = await pollTcatShipmentStatuses()
    expect(second.logsCreated).toBe(0)
    expect(await db.logisticsStatusLog.count({ where: { shipmentId: shipment.id } })).toBe(1)

    await db.shipment.update({
      where: { id: shipment.id },
      data: { statusPolledAt: new Date(Date.now() - 3 * HOURS) },
    })

    // 第三輪：歷程多了一筆新事件（黑貓由新到舊回完整清單）→ 只追加那一筆
    queryObtStatusMock.mockResolvedValue([
      obtStatus('OBT-H', {
        StatusId: '301',
        StatusName: '配完',
        StatusList: [
          { StatusId: '301', StatusName: '配完', CreateDateTime: '20260815120000', StationName: '台北營業所' },
          ...firstList,
        ],
      }),
    ])

    const third = await pollTcatShipmentStatuses()
    expect(third.logsCreated).toBe(1)

    const logs = await db.logisticsStatusLog.findMany({
      where: { shipmentId: shipment.id },
      orderBy: { occurredAt: 'asc' },
    })
    expect(logs).toHaveLength(2)
    expect(logs.map((l) => l.statusCode)).toEqual(['151', '301'])
    // 營業所名稱一起寫進訊息（客服要用）
    expect(logs[1]!.message).toBe('配完（台北營業所）')
  })
})
