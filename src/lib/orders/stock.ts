import 'server-only'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

type Tx = Prisma.TransactionClient

/**
 * 庫存預扣。
 *
 * 用一句帶條件的 UPDATE 完成「檢查 + 佔用」，而不是先 SELECT 再 UPDATE ——
 * 後者在兩個人同時搶最後一件時會雙雙通過檢查而超賣。
 * PostgreSQL 會在 UPDATE 時對該列加鎖，條件不成立就是 0 rows affected，
 * 我們據此判斷庫存不足。
 */
export async function reserveStock(tx: Tx, variantId: string, qty: number): Promise<boolean> {
  const affected = await tx.$executeRaw`
    UPDATE product_variants
       SET "reservedStock" = "reservedStock" + ${qty}
     WHERE id = ${variantId}
       AND "isActive" = true
       AND stock - "reservedStock" >= ${qty}
  `
  return affected === 1
}

/**
 * 付款成功：把預扣轉成實際扣減。
 * stock 減掉、reservedStock 也減掉，淨效果是可售數量不變（本來就已經被佔住了）。
 */
export async function commitReservation(tx: Tx, variantId: string, qty: number): Promise<void> {
  await tx.$executeRaw`
    UPDATE product_variants
       SET stock = stock - ${qty},
           "reservedStock" = GREATEST(0, "reservedStock" - ${qty})
     WHERE id = ${variantId}
  `
}

/** 訂單取消或逾期：把佔住的數量還回去。 */
export async function releaseReservation(tx: Tx, variantId: string, qty: number): Promise<void> {
  await tx.$executeRaw`
    UPDATE product_variants
       SET "reservedStock" = GREATEST(0, "reservedStock" - ${qty})
     WHERE id = ${variantId}
  `
}

/**
 * 把一張訂單的所有預扣一次轉為實扣。付款成功時呼叫。
 * 已經 commit 過的會被 where 條件擋掉，所以綠界重送通知不會重複扣庫存。
 */
export async function commitOrderReservations(tx: Tx, orderId: string): Promise<number> {
  const reservations = await tx.stockReservation.findMany({
    where: { orderId, committedAt: null, releasedAt: null },
  })

  for (const reservation of reservations) {
    await commitReservation(tx, reservation.variantId, reservation.qty)
  }

  if (reservations.length > 0) {
    await tx.stockReservation.updateMany({
      where: { id: { in: reservations.map((r) => r.id) } },
      data: { committedAt: new Date() },
    })
  }

  return reservations.length
}

/** 把一張訂單的所有預扣釋放。取消訂單時呼叫。 */
export async function releaseOrderReservations(tx: Tx, orderId: string): Promise<number> {
  const reservations = await tx.stockReservation.findMany({
    where: { orderId, committedAt: null, releasedAt: null },
  })

  for (const reservation of reservations) {
    await releaseReservation(tx, reservation.variantId, reservation.qty)
  }

  if (reservations.length > 0) {
    await tx.stockReservation.updateMany({
      where: { id: { in: reservations.map((r) => r.id) } },
      data: { releasedAt: new Date() },
    })
  }

  return reservations.length
}

/**
 * 掃出所有逾期未付款的訂單，取消它們並把庫存還回去。
 * 由 worker 定期呼叫。
 */
export async function releaseExpiredReservations(): Promise<{
  ordersCancelled: number
  itemsReleased: number
}> {
  const expired = await db.stockReservation.findMany({
    where: {
      expiresAt: { lt: new Date() },
      releasedAt: null,
      committedAt: null,
      order: { status: 'PENDING_PAYMENT' },
    },
    select: { orderId: true },
    distinct: ['orderId'],
  })

  let itemsReleased = 0

  for (const { orderId } of expired) {
    await db.$transaction(async (tx) => {
      // 交易內重讀一次狀態：這段期間付款通知可能剛好進來
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { status: true },
      })
      if (order?.status !== 'PENDING_PAYMENT') return

      itemsReleased += await releaseOrderReservations(tx, orderId)

      await tx.order.update({
        where: { id: orderId },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      })
      await tx.payment.updateMany({
        where: { orderId, status: { in: ['PENDING', 'AWAITING_TRANSFER'] } },
        data: { status: 'EXPIRED' },
      })
    })
  }

  return { ordersCancelled: expired.length, itemsReleased }
}
