import 'server-only'
import { db } from '@/lib/db'
import { currentUser } from '@/lib/auth'
import { normalizeTwMobile } from '@/lib/sms/provider'

/**
 * 消費者對自己訂單動手腳（改付款方式、申請退款）之前的身分檢查。
 *
 * 兩條路都可以：
 *   - 會員：訂單的 userId 就是自己
 *   - 訪客：訂單編號 + Email 或手機（與訪客訂單查詢同一套規則）
 *
 * 光憑訂單編號不夠 —— 出貨單上就印著編號，撿到包裹的人不該能把別人的
 * 繳費代碼作廢或送出退款申請。
 */
export type OrderAccess =
  | { ok: true; orderId: string }
  | { ok: false; error: 'NOT_FOUND' | 'CONTACT_REQUIRED' | 'CONTACT_MISMATCH' }

export async function resolveOrderAccess(input: {
  orderNo: string
  /** 訪客填的 Email 或手機。會員不需要。 */
  contact?: string
}): Promise<OrderAccess> {
  const orderNo = input.orderNo.trim().toUpperCase()
  if (!orderNo) return { ok: false, error: 'NOT_FOUND' }

  const order = await db.order.findUnique({
    where: { orderNo },
    select: { id: true, userId: true, email: true, phone: true, recipientPhone: true },
  })
  if (!order) return { ok: false, error: 'NOT_FOUND' }

  const user = await currentUser()
  if (user && order.userId && order.userId === user.id) {
    return { ok: true, orderId: order.id }
  }

  const contact = input.contact?.trim()
  if (!contact) return { ok: false, error: 'CONTACT_REQUIRED' }

  const phone = normalizeTwMobile(contact)
  const matches =
    order.email === contact.toLowerCase() ||
    (phone !== null && (order.phone === phone || order.recipientPhone === phone))

  return matches ? { ok: true, orderId: order.id } : { ok: false, error: 'CONTACT_MISMATCH' }
}
