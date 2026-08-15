import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import {
  commitOrderReservations,
  commitReservation,
  releaseExpiredReservations,
  releaseOrderReservations,
  releaseReservation,
  reserveStock,
} from '@/lib/orders/stock'
import { createTestOrder, createTestProduct } from '../factories'

/**
 * 庫存預扣的整合測試 —— 連真實 Postgres。
 *
 * 併發測試（兩人搶最後一件）必須跑在真的交易與列鎖上才有意義，
 * 這正是整合測試存在的理由，不能用 mock 的 db 代替。
 */

async function freshVariant(id: string) {
  return db.productVariant.findUniqueOrThrow({ where: { id } })
}

describe('reserveStock — 預扣庫存', () => {
  it('可售數量足夠時回 true 並遞增 reservedStock', async () => {
    const { variants } = await createTestProduct({ stock: 10 })

    const ok = await reserveStock(db, variants[0].id, 3)

    expect(ok).toBe(true)
    const v = await freshVariant(variants[0].id)
    expect(v.reservedStock).toBe(3)
    expect(v.stock).toBe(10) // 預扣不動 stock，付款成功才實扣
  })

  it('庫存不足時回 false 且 reservedStock 不變', async () => {
    const { variants } = await createTestProduct({ stock: 2 })

    const ok = await reserveStock(db, variants[0].id, 3)

    expect(ok).toBe(false)
    const v = await freshVariant(variants[0].id)
    expect(v.reservedStock).toBe(0)
  })

  it('變體已停用（isActive=false）時回 false', async () => {
    const { variants } = await createTestProduct({ stock: 10, isActiveVariant: false })

    const ok = await reserveStock(db, variants[0].id, 1)

    expect(ok).toBe(false)
    const v = await freshVariant(variants[0].id)
    expect(v.reservedStock).toBe(0)
  })

  it('計入既有的 reservedStock：stock 5、已預扣 4，再要 2 就不夠', async () => {
    const { variants } = await createTestProduct({ stock: 5, reservedStock: 4 })

    const ok = await reserveStock(db, variants[0].id, 2)

    expect(ok).toBe(false)
    const v = await freshVariant(variants[0].id)
    expect(v.reservedStock).toBe(4)

    // 剩下的 1 件還是要得到
    expect(await reserveStock(db, variants[0].id, 1)).toBe(true)
    expect((await freshVariant(variants[0].id)).reservedStock).toBe(5)
  })

  it('C-02：兩個交易同時搶最後一件，恰好一個成功、絕不超賣', async () => {
    const { variants } = await createTestProduct({ stock: 1 })

    const results = await Promise.all([
      db.$transaction((tx) => reserveStock(tx, variants[0].id, 1)),
      db.$transaction((tx) => reserveStock(tx, variants[0].id, 1)),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
    const v = await freshVariant(variants[0].id)
    expect(v.reservedStock).toBe(1) // 絕不能是 2

    // 變化型：stock 3、兩人各要 2 → 也只能有一個贏家
    const { variants: variants2 } = await createTestProduct({ stock: 3 })
    const results2 = await Promise.all([
      db.$transaction((tx) => reserveStock(tx, variants2[0].id, 2)),
      db.$transaction((tx) => reserveStock(tx, variants2[0].id, 2)),
    ])
    expect(results2.filter(Boolean)).toHaveLength(1)
    expect((await freshVariant(variants2[0].id)).reservedStock).toBe(2)
  })
})

describe('commitOrderReservations — 預扣轉實扣', () => {
  it('stock 與 reservedStock 同時遞減、committedAt 設定並回傳筆數', async () => {
    const { order, variant } = await createTestOrder({ qty: 2 })

    const committed = await db.$transaction((tx) => commitOrderReservations(tx, order.id))

    expect(committed).toBe(1)
    const v = await freshVariant(variant.id)
    expect(v.stock).toBe(8)
    expect(v.reservedStock).toBe(0)

    const reservation = await db.stockReservation.findFirstOrThrow({
      where: { orderId: order.id },
    })
    expect(reservation.committedAt).not.toBeNull()
    expect(reservation.releasedAt).toBeNull()
  })

  it('重複 commit 回 0 且 stock 不會扣第二次（綠界重送安全）', async () => {
    const { order, variant } = await createTestOrder({ qty: 2 })

    await db.$transaction((tx) => commitOrderReservations(tx, order.id))
    const second = await db.$transaction((tx) => commitOrderReservations(tx, order.id))

    expect(second).toBe(0)
    const v = await freshVariant(variant.id)
    expect(v.stock).toBe(8) // 只扣一次
    expect(v.reservedStock).toBe(0)
  })

  it('已釋放（releasedAt 有值）的預扣會被跳過', async () => {
    const { order, variant } = await createTestOrder({ qty: 1 })
    await db.stockReservation.updateMany({
      where: { orderId: order.id },
      data: { releasedAt: new Date() },
    })

    const committed = await db.$transaction((tx) => commitOrderReservations(tx, order.id))

    expect(committed).toBe(0)
    const v = await freshVariant(variant.id)
    expect(v.stock).toBe(10) // 完全沒動
    const reservation = await db.stockReservation.findFirstOrThrow({
      where: { orderId: order.id },
    })
    expect(reservation.committedAt).toBeNull()
  })
})

describe('releaseOrderReservations — 釋放預扣', () => {
  it('reservedStock 歸還、releasedAt 設定，且冪等', async () => {
    const { order, variant } = await createTestOrder({ qty: 2 })
    expect((await freshVariant(variant.id)).reservedStock).toBe(2)

    const released = await db.$transaction((tx) => releaseOrderReservations(tx, order.id))
    expect(released).toBe(1)

    const v = await freshVariant(variant.id)
    expect(v.stock).toBe(10) // 釋放不動 stock
    expect(v.reservedStock).toBe(0)
    const reservation = await db.stockReservation.findFirstOrThrow({
      where: { orderId: order.id },
    })
    expect(reservation.releasedAt).not.toBeNull()
    expect(reservation.committedAt).toBeNull()

    // 再放一次不會多還
    const again = await db.$transaction((tx) => releaseOrderReservations(tx, order.id))
    expect(again).toBe(0)
    expect((await freshVariant(variant.id)).reservedStock).toBe(0)
  })
})

describe('releaseExpiredReservations — 逾期未付款掃描', () => {
  it('逾期的 PENDING_PAYMENT 訂單被取消、payment 標為 EXPIRED、預扣釋放', async () => {
    const { order, variant } = await createTestOrder({
      qty: 2,
      reservationExpiresAt: new Date(Date.now() - 60_000),
    })

    const result = await releaseExpiredReservations()

    expect(result.ordersCancelled).toBe(1)
    expect(result.itemsReleased).toBe(1)

    const fresh = await db.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payment: true, reservations: true },
    })
    expect(fresh.status).toBe('CANCELLED')
    expect(fresh.cancelledAt).not.toBeNull()
    expect(fresh.payment?.status).toBe('EXPIRED')
    expect(fresh.reservations[0]?.releasedAt).not.toBeNull()

    const v = await freshVariant(variant.id)
    expect(v.stock).toBe(10)
    expect(v.reservedStock).toBe(0)
  })

  it('未逾期的訂單不動', async () => {
    const { order, variant } = await createTestOrder({
      reservationExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
    })

    const result = await releaseExpiredReservations()

    expect(result.ordersCancelled).toBe(0)
    const fresh = await db.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payment: true },
    })
    expect(fresh.status).toBe('PENDING_PAYMENT')
    expect(fresh.payment?.status).toBe('PENDING')
    expect((await freshVariant(variant.id)).reservedStock).toBe(1)
  })

  it('已付款訂單就算預扣過期也不動（付款通知先到的情況）', async () => {
    const { order, variant } = await createTestOrder({
      status: 'PAID',
      paymentStatus: 'PAID',
      reservationExpiresAt: new Date(Date.now() - 60_000),
    })

    const result = await releaseExpiredReservations()

    expect(result.ordersCancelled).toBe(0)
    const fresh = await db.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payment: true, reservations: true },
    })
    expect(fresh.status).toBe('PAID')
    expect(fresh.payment?.status).toBe('PAID')
    expect(fresh.reservations[0]?.releasedAt).toBeNull()
    expect((await freshVariant(variant.id)).reservedStock).toBe(1)
  })
})

describe('GREATEST(0, ...) 下限', () => {
  it('releaseReservation 不會把 reservedStock 減成負數', async () => {
    const { variants } = await createTestProduct({ stock: 10, reservedStock: 0 })

    await releaseReservation(db, variants[0].id, 5)

    const v = await freshVariant(variants[0].id)
    expect(v.reservedStock).toBe(0)
    expect(v.stock).toBe(10)
  })

  it('commitReservation 在 reservedStock 為 0 時也不會變負（stock 照實扣）', async () => {
    const { variants } = await createTestProduct({ stock: 10, reservedStock: 0 })

    await commitReservation(db, variants[0].id, 2)

    const v = await freshVariant(variants[0].id)
    expect(v.reservedStock).toBe(0) // GREATEST 擋住負數
    expect(v.stock).toBe(8)
  })
})
