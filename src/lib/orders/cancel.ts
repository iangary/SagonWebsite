import 'server-only'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { releaseOrderReservations } from './stock'

type Tx = Prisma.TransactionClient

/**
 * 取消一張「還沒付款」的訂單：狀態改成已取消、還庫存、作廢還沒繳的代碼、還折扣碼。
 *
 * 消費者自己取消、後台人工取消、逾期排程三條路都走這一支，規則才不會分岔。
 *
 * 狀態用帶條件的 UPDATE 搶（WHERE status = 'PENDING_PAYMENT'），而不是先讀再寫 ——
 * 付款通知可能剛好同時進來，先讀再寫的話兩邊都會以為自己贏了。
 * 搶輸就回 null，呼叫端自己決定要告訴誰。
 *
 * 取消之後才進來的款項不在這裡處理：applySuccessfulPayment 看到訂單已取消，
 * 會自動開一張退款單（逾期入帳）。
 */
export async function cancelUnpaidOrder(
  tx: Tx,
  orderId: string,
): Promise<{ itemsReleased: number } | null> {
  await lockOrderPayments(tx, orderId)

  const claimed = await tx.order.updateMany({
    where: { id: orderId, status: 'PENDING_PAYMENT' },
    data: { status: 'CANCELLED', cancelledAt: new Date() },
  })
  if (claimed.count !== 1) return null

  const itemsReleased = await releaseOrderReservations(tx, orderId)

  await tx.payment.updateMany({
    where: { orderId, status: { in: ['PENDING', 'AWAITING_TRANSFER'] } },
    data: { status: 'EXPIRED' },
  })

  // 折扣碼還回去：沒付款的訂單不算真的用過，否則「取消後重新下單」會被
  // 每人限用次數擋下。Order.couponId 仍留著，看得出這張單當初用了哪張券。
  const redemption = await tx.couponRedemption.findUnique({
    where: { orderId },
    select: { id: true, couponId: true },
  })
  if (redemption) {
    await tx.couponRedemption.delete({ where: { id: redemption.id } })
    await tx.$executeRaw`
      UPDATE coupons
         SET "usedCount" = GREATEST(0, "usedCount" - 1)
       WHERE id = ${redemption.couponId}
    `
  }

  return { itemsReleased }
}

/** 不在交易裡的呼叫端用這個。 */
export function cancelUnpaidOrderNow(orderId: string) {
  return db.$transaction((tx) => cancelUnpaidOrder(tx, orderId))
}

/**
 * 取消與付款入帳之間的「門」：兩邊動手前都先鎖住這張訂單的所有付款紀錄。
 *
 * 一定要在讀訂單狀態「之前」鎖 —— 先讀再等鎖的話，等到的時候讀到的狀態已經過期，
 * 付款那邊會把剛取消（庫存已放掉）的訂單蓋回 PAID，變成超賣。
 * 兩邊都從 payments 開始鎖，順序一致，也就不會互相死鎖。
 */
export async function lockOrderPayments(tx: Tx, orderId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM payments WHERE "orderId" = ${orderId} ORDER BY id FOR UPDATE`
}
