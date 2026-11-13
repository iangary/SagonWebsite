'use server'

import { cookies, headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { clientIp, peekRateLimit, recordRateLimitHit } from '@/lib/rate-limit'
import { findGuestOrder, ORDER_QUERY_COOKIE, ORDER_QUERY_COOKIE_MAX_AGE } from '@/lib/orders/guest-query'

/** 同一個 IP 15 分鐘內最多查錯幾次。只算查無資料，正常查詢不受影響。 */
const QUERY_FAILURES_PER_IP = 20
const QUERY_WINDOW_SECONDS = 15 * 60

export type OrderQueryState = { error?: string }

/**
 * 查詢改走 POST（以前是 `<form method="get">`）：
 * - 手機與 Email 不再出現在網址列，也就不會被 Caddy 的 access.log、瀏覽器歷史與 Referer 帶走。
 * - 查錯有 IP 節流，不能拿訂單編號配一串電話號碼慢慢試。
 *
 * 查到就把條件放進 httpOnly cookie。Server Action 寫了 cookie 之後 Next 會重新 render 這一頁，
 * page.tsx 讀 cookie 顯示結果（重新整理也還在，30 分鐘後失效）。
 */
export async function queryOrder(
  _prev: OrderQueryState,
  formData: FormData,
): Promise<OrderQueryState> {
  const t = await getTranslations('orderQuery')
  const orderNo = String(formData.get('orderNo') ?? '').trim()
  const contact = String(formData.get('contact') ?? '').trim()
  if (!orderNo || !contact) return { error: t('notFound') }

  const ipKey = `order-query:ip:${clientIp(await headers())}`
  const limit = await peekRateLimit(ipKey, QUERY_FAILURES_PER_IP)
  if (!limit.ok) return { error: (await getTranslations('errors'))('tooManyRequests') }

  const order = await findGuestOrder(orderNo, contact)
  if (!order) {
    await recordRateLimitHit(ipKey, QUERY_WINDOW_SECONDS)
    return { error: t('notFound') }
  }

  const cookieStore = await cookies()
  cookieStore.set(ORDER_QUERY_COOKIE, JSON.stringify({ orderNo, contact }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ORDER_QUERY_COOKIE_MAX_AGE,
  })
  return {}
}
