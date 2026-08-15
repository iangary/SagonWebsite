import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Package } from 'lucide-react'
import { Link } from '@/i18n/routing'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { OrderSummaryCard } from '@/components/order/order-summary-card'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'account' })
  return { title: t('orders'), robots: { index: false } }
}

export default async function AccountOrdersPage() {
  const user = await requireUser()

  const [t, orders] = await Promise.all([
    getTranslations('account'),
    db.order.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      include: { items: true, payment: true, shipment: true, invoice: true },
    }),
  ])

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center border border-cream-200 bg-white py-20 text-center">
        <Package size={36} strokeWidth={1} className="text-taupe-400" />
        <p className="mt-5 text-sm text-ink-700">{t('noOrders')}</p>
        <Button asChild className="mt-6">
          <Link href="/product/all">{t('startShopping')}</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {orders.map((order) => (
        <OrderSummaryCard key={order.id} order={order} showReviewLink />
      ))}
    </div>
  )
}
