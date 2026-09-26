import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProductVariant, ShipmentStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { createTestOrder, createTestProduct } from '../factories'

vi.mock('@/lib/tcat/client', () => ({
  TcatApiError: class TcatApiError extends Error {},
  parsingAddress: vi.fn(),
  printObt: vi.fn(),
  downloadObt: vi.fn(),
  callPickup: vi.fn(),
  queryObtStatus: vi.fn(),
}))

import { callPickup } from '@/lib/tcat/client'
import {
  callTcatPickup,
  listPendingTcatParcels,
  pendingTcatParcelCount,
  pickupDateToday,
  todayPickupCall,
} from '@/lib/orders/tcat-pickup'

const callPickupMock = vi.mocked(callPickup)

let sharedVariant: ProductVariant
let seq = 0

beforeEach(async () => {
  vi.resetAllMocks()
  callPickupMock.mockResolvedValue({
    srvTranId: 'TN20260816000011',
    message: '集貨通知已送出成功，司機將於 3 點後前往取件',
  })
  const { variants } = await createTestProduct({ stock: 100 })
  sharedVariant = variants[0]!
})

async function makeTcatShipment(
  input: { shipmentNo?: string | null; shipmentStatus?: ShipmentStatus } = {},
) {
  seq += 1
  const { order } = await createTestOrder({
    variant: sharedVariant,
    withReservations: false,
    shippingMethod: 'HOME',
    status: 'PROCESSING',
    shipmentStatus: input.shipmentStatus ?? 'CREATED',
    shipmentOverrides: {
      shipmentNo: input.shipmentNo === undefined ? `OBT${String(seq).padStart(4, '0')}` : input.shipmentNo,
    },
  })
  return order.shipment!
}

describe('pendingTcatParcelCount', () => {
  it('只算黑貓、已配號、還沒被收走（CREATED）、也還沒排入收貨的單', async () => {
    await makeTcatShipment() // ✓
    await makeTcatShipment() // ✓
    await makeTcatShipment({ shipmentNo: null }) // 還沒建單
    await makeTcatShipment({ shipmentStatus: 'IN_TRANSIT' }) // 司機已收走
    await createTestOrder({
      variant: sharedVariant,
      withReservations: false,
      shippingMethod: 'CVS',
      shipmentStatus: 'CREATED',
      shipmentOverrides: { shipmentNo: 'CVSNO1' },
    })
    // 已經排進某一趟收貨
    const shipment = await makeTcatShipment()
    const call = await db.tcatPickupCall.create({
      data: { callDate: '20260101', succeededDate: '20260101', quantity: 1 },
    })
    await db.shipment.update({ where: { id: shipment.id }, data: { pickupCallId: call.id } })

    expect(await pendingTcatParcelCount()).toBe(2)
    expect(await listPendingTcatParcels()).toHaveLength(2)
  })
})

describe('callTcatPickup', () => {
  it('指定訂單：件數照勾選數、單號寫進備註，成功後把這些單掛到這趟收貨', async () => {
    const a = await makeTcatShipment()
    const b = await makeTcatShipment()
    const notChosen = await makeTcatShipment()

    const call = await callTcatPickup({
      shipmentIds: [a.id, b.id],
      memo: '請走側門',
    })

    expect(callPickupMock).toHaveBeenCalledTimes(1)
    const request = callPickupMock.mock.calls[0]![0]
    expect(request).toMatchObject({ NormalQuantity: 2, ColdQuantity: 0, FreezeQuantity: 0 })
    expect(request.Memo).toBe(`請走側門 單號:${a.shipmentNo},${b.shipmentNo}`)

    expect(call.quantity).toBe(2)
    expect(call.succeededDate).toBe(pickupDateToday())
    expect(call.srvTranId).toBe('TN20260816000011')
    expect(await todayPickupCall()).not.toBeNull()

    const linked = await db.shipment.findMany({ where: { pickupCallId: call.id }, select: { id: true } })
    expect(linked.map((s) => s.id).sort()).toEqual([a.id, b.id].sort())
    // 沒勾的那張還留在待交寄
    expect((await listPendingTcatParcels()).map((p) => p.id)).toEqual([notChosen.id])
  })

  it('其他包裹（例如直接在黑貓系統開的單）加進件數，沒有單號可綁', async () => {
    const a = await makeTcatShipment()

    const call = await callTcatPickup({ shipmentIds: [a.id], extraParcels: 2 })

    expect(callPickupMock.mock.calls[0]![0]).toMatchObject({ NormalQuantity: 3 })
    expect(callPickupMock.mock.calls[0]![0].Memo).toContain('另2件非網站建單')
    expect(call.quantity).toBe(3)
  })

  it('只有其他包裹、沒有勾任何訂單也可以叫車', async () => {
    const call = await callTcatPickup({ shipmentIds: [], extraParcels: 1 })
    expect(call.quantity).toBe(1)
    expect(callPickupMock).toHaveBeenCalledTimes(1)
  })

  it('勾到已經不在待交寄的單（畫面開著時被收走或排進別趟）：整個擋下，不默默少叫', async () => {
    const a = await makeTcatShipment()
    const gone = await makeTcatShipment({ shipmentStatus: 'IN_TRANSIT' })

    await expect(
      callTcatPickup({ shipmentIds: [a.id, gone.id] }),
    ).rejects.toThrow(/有 1 張已經不在待交寄清單/)

    expect(callPickupMock).not.toHaveBeenCalled()
    expect(await db.tcatPickupCall.count()).toBe(0)
  })

  it('同一天第二次：直接擋下來，不再打 API（黑貓每個收貨點每日只受理一次）', async () => {
    await callTcatPickup({ shipmentIds: [], extraParcels: 1 })
    callPickupMock.mockClear()

    await expect(callTcatPickup({ shipmentIds: [], extraParcels: 1 })).rejects.toThrow(/今天已經呼叫過黑貓/)
    expect(callPickupMock).not.toHaveBeenCalled()
    expect(await db.tcatPickupCall.count()).toBe(1)
  })

  it('黑貓退件時把當天的名額讓出來、訂單也不綁，可以修正後重叫', async () => {
    const a = await makeTcatShipment()
    callPickupMock.mockRejectedValueOnce(new Error('黑貓 Call：E999 測試退件'))

    await expect(callTcatPickup({ shipmentIds: [a.id] })).rejects.toThrow(/呼叫黑貓失敗/)

    // 失敗那筆留著當歷程，但不佔今天的名額
    const failed = await db.tcatPickupCall.findFirstOrThrow()
    expect(failed.succeededDate).toBeNull()
    expect(failed.callDate).toBe(pickupDateToday())
    expect(failed.message).toContain('E999')
    expect(await todayPickupCall()).toBeNull()
    // 單還在待交寄，重叫時選得到
    expect(await pendingTcatParcelCount()).toBe(1)

    const retry = await callTcatPickup({ shipmentIds: [a.id] })
    expect(retry.succeededDate).toBe(pickupDateToday())
    expect(await db.tcatPickupCall.count()).toBe(2)
    expect(await pendingTcatParcelCount()).toBe(0)
  })

  it('一件都沒有時連名額都不佔（電文組不出來就不該碰 DB）', async () => {
    await expect(callTcatPickup({ shipmentIds: [] })).rejects.toThrow(/件數/)

    expect(callPickupMock).not.toHaveBeenCalled()
    expect(await db.tcatPickupCall.count()).toBe(0)
  })

  it('兩個管理員同時按：唯一鍵讓其中一個先打，另一個被擋（不會叫兩台車）', async () => {
    const results = await Promise.allSettled([
      callTcatPickup({ shipmentIds: [], extraParcels: 1 }),
      callTcatPickup({ shipmentIds: [], extraParcels: 1 }),
    ])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(callPickupMock).toHaveBeenCalledTimes(1)
  })
})
