import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { OrderSummaryCard } from '@/components/order/order-summary-card'
import { OrderQueryForm } from './query-form'
import { findGuestOrder, ORDER_QUERY_COOKIE, readSavedQuery } from '@/lib/orders/guest-query'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'nav' })
  return { title: t('orderQuery'), alternates: { canonical: '/order/query' } }
}

/**
 * 訪客訂單查詢。查詢條件走 POST（見 actions.ts），這一頁只負責顯示 cookie 記住的那筆。
 * cookie 裡的條件每次都重新比對，不是查過一次就放行。
 */
export default async function OrderQueryPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const [t, cookieStore] = await Promise.all([getTranslations('orderQuery'), cookies()])

  const saved = readSavedQuery(cookieStore.get(ORDER_QUERY_COOKIE)?.value)
  const order = saved ? await findGuestOrder(saved.orderNo, saved.contact) : null

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-xs tracking-[0.3em] text-taupe-600 uppercase">Order</p>
      <h1 className="mt-4 text-3xl">{t('title')}</h1>
      <p className="mt-4 text-sm leading-loose text-ink-700">{t('intro')}</p>

      <OrderQueryForm
        defaultOrderNo={order && saved ? saved.orderNo : ''}
        defaultContact={order && saved ? saved.contact : ''}
      />

      {order && (
        <div className="mt-10">
          <OrderSummaryCard order={order} />
        </div>
      )}
    </div>
  )
}
