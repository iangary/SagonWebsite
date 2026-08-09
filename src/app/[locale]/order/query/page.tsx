import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { db } from '@/lib/db'
import { normalizeTwMobile } from '@/lib/sms/provider'
import { OrderSummaryCard } from '@/components/order/order-summary-card'
import { OrderQueryForm } from './query-form'

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
 * 訪客訂單查詢。
 *
 * 用訂單編號 + 手機（或 Email）雙因素比對 —— 只有訂單編號的話，
 * 任何人拿到出貨單就能看到別人的收件資訊。
 */
export default async function OrderQueryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ orderNo?: string; contact?: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const sp = await searchParams

  let order = null
  let notFound = false

  if (sp.orderNo?.trim() && sp.contact?.trim()) {
    const orderNo = sp.orderNo.trim().toUpperCase()
    const contact = sp.contact.trim()
    const phone = normalizeTwMobile(contact)

    order = await db.order.findFirst({
      where: {
        orderNo,
        OR: [
          { email: contact.toLowerCase() },
          ...(phone ? [{ phone }, { recipientPhone: phone }] : []),
        ],
      },
      include: { items: true, payment: true, shipment: true, invoice: true },
    })
    notFound = order === null
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-xs tracking-[0.3em] text-taupe-600 uppercase">Order</p>
      <h1 className="mt-4 text-3xl">訂單查詢</h1>
      <p className="mt-4 text-sm leading-loose text-ink-700">
        輸入訂單編號，以及下單時填寫的手機號碼或電子信箱即可查詢。
      </p>

      <OrderQueryForm defaultOrderNo={sp.orderNo ?? ''} defaultContact={sp.contact ?? ''} />

      {notFound && (
        <p className="mt-8 border border-sale/30 bg-sale/5 px-4 py-3 text-sm text-sale">
          查不到符合的訂單。請確認訂單編號與聯絡方式是否正確。
        </p>
      )}

      {order && (
        <div className="mt-10">
          <OrderSummaryCard order={order} />
        </div>
      )}
    </div>
  )
}
