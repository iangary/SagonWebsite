import 'server-only'
import { db } from '@/lib/db'
import { normalizeTwMobile } from '@/lib/sms/provider'

/** 查詢成功後記住條件的 cookie。httpOnly、30 分鐘，只存在查詢者自己的瀏覽器裡。 */
export const ORDER_QUERY_COOKIE = 'sagon_order_query'
export const ORDER_QUERY_COOKIE_MAX_AGE = 30 * 60

/**
 * 訪客訂單查詢：訂單編號 + 手機（或 Email）雙因素比對 ——
 * 只有訂單編號的話，任何人拿到出貨單就能看到別人的收件資訊。
 */
export function findGuestOrder(rawOrderNo: string, rawContact: string) {
  const orderNo = rawOrderNo.trim().toUpperCase()
  const contact = rawContact.trim()
  if (!orderNo || !contact) return Promise.resolve(null)
  const phone = normalizeTwMobile(contact)

  return db.order.findFirst({
    where: {
      orderNo,
      OR: [
        { email: contact.toLowerCase() },
        ...(phone ? [{ phone }, { recipientPhone: phone }] : []),
      ],
    },
    include: {
      items: true,
      payments: { orderBy: { createdAt: 'desc' } },
      shipment: true,
      invoice: true,
    },
  })
}

export type SavedOrderQuery = { orderNo: string; contact: string }

/** cookie 是查詢成功時由 actions.ts 寫的；壞掉或被竄改就當作沒查過 */
export function readSavedQuery(raw: string | undefined): SavedOrderQuery | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { orderNo?: unknown; contact?: unknown }
    if (typeof parsed.orderNo !== 'string' || typeof parsed.contact !== 'string') return null
    return { orderNo: parsed.orderNo, contact: parsed.contact }
  } catch {
    return null
  }
}

/**
 * 這位訪客剛剛是不是用「訂單編號 + 聯絡方式」查過這張單。
 * cookie 是他自己的瀏覽器送的，內容可以亂寫 —— 所以要拿聯絡方式重新比對訂單，不是看到編號就放行。
 */
export function savedQueryMatches(
  saved: SavedOrderQuery | null,
  order: { orderNo: string; email: string | null; phone: string | null; recipientPhone: string | null },
): boolean {
  if (!saved || saved.orderNo.trim().toUpperCase() !== order.orderNo) return false
  const contact = saved.contact.trim()
  if (!contact) return false
  const phone = normalizeTwMobile(contact)
  return (
    order.email === contact.toLowerCase() ||
    (phone !== null && (order.phone === phone || order.recipientPhone === phone))
  )
}
