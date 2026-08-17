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
  return createTestOrder({
    variant: sharedVariant,
    withReservations: false,
    shippingMethod: 'HOME',
    status: 'PROCESSING',
    shipmentStatus: input.shipmentStatus ?? 'CREATED',
    shipmentOverrides: {
      shipmentNo: input.shipmentNo === undefined ? `OBT${String(seq).padStart(4, '0')}` : input.shipmentNo,
    },
  })
}

describe('pendingTcatParcelCount', () => {
  it('只算黑貓、已配號、還沒被收走（CREATED）的單', async () => {
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

    expect(await pendingTcatParcelCount()).toBe(2)
  })
})

describe('callTcatPickup', () => {
  it('成功時打一次 API 並留下當天的成功紀錄', async () => {
    await makeTcatShipment()
    await makeTcatShipment()

    const call = await callTcatPickup({ memo: '請走側門' })

    expect(callPickupMock).toHaveBeenCalledTimes(1)
    // 件數沒指定時用「待交寄的包裹數」
    expect(callPickupMock.mock.calls[0]![0]).toMatchObject({
      NormalQuantity: 2,
      ColdQuantity: 0,
      FreezeQuantity: 0,
      Memo: '請走側門',
    })

    expect(call.quantity).toBe(2)
    expect(call.succeededDate).toBe(pickupDateToday())
    expect(call.srvTranId).toBe('TN20260816000011')
    expect(await todayPickupCall()).not.toBeNull()
  })

  it('同一天第二次：直接擋下來，不再打 API（黑貓每個收貨點每日只受理一次）', async () => {
    await callTcatPickup({ quantity: 1 })
    callPickupMock.mockClear()

    await expect(callTcatPickup({ quantity: 1 })).rejects.toThrow(/今天已經呼叫過黑貓/)
    expect(callPickupMock).not.toHaveBeenCalled()
    expect(await db.tcatPickupCall.count()).toBe(1)
  })

  it('黑貓退件時把當天的名額讓出來，可以修正後重叫', async () => {
    callPickupMock.mockRejectedValueOnce(new Error('黑貓 Call：E999 測試退件'))

    await expect(callTcatPickup({ quantity: 2 })).rejects.toThrow(/呼叫黑貓失敗/)

    // 失敗那筆留著當歷程，但不佔今天的名額
    const failed = await db.tcatPickupCall.findFirstOrThrow()
    expect(failed.succeededDate).toBeNull()
    expect(failed.callDate).toBe(pickupDateToday())
    expect(failed.message).toContain('E999')
    expect(await todayPickupCall()).toBeNull()

    // 重叫會成功
    const retry = await callTcatPickup({ quantity: 2 })
    expect(retry.succeededDate).toBe(pickupDateToday())
    expect(await db.tcatPickupCall.count()).toBe(2)
  })

  it('資料不合規時連名額都不佔（電文組不出來就不該碰 DB）', async () => {
    await expect(callTcatPickup({ quantity: 0 })).rejects.toThrow(/件數/)

    expect(callPickupMock).not.toHaveBeenCalled()
    expect(await db.tcatPickupCall.count()).toBe(0)
  })

  it('兩個管理員同時按：唯一鍵讓其中一個先打，另一個被擋（不會叫兩台車）', async () => {
    const results = await Promise.allSettled([
      callTcatPickup({ quantity: 1 }),
      callTcatPickup({ quantity: 1 }),
    ])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(callPickupMock).toHaveBeenCalledTimes(1)
  })
})
