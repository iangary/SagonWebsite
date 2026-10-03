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
