import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import Image from 'next/image'
import { ArrowLeft } from 'lucide-react'
import { Link } from '@/i18n/routing'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { ReviewForm } from './review-form'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'review' })
  return { title: t('pageTitle'), robots: { index: false } }
}

export default async function WriteReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [t, user] = await Promise.all([getTranslations('review'), requireUser()])

  // where 帶 userId，別人的訂單看不到
  const order = await db.order.findFirst({
    where: { id, userId: user.id },
    include: {
      items: {
        include: {
          reviews: { select: { id: true, rating: true, body: true } },
          variant: { select: { product: { select: { id: true, slug: true } } } },
        },
      },
    },
  })

  if (!order) notFound()

  if (order.status !== 'COMPLETED') {
    return (
      <div className="border border-cream-200 bg-white p-8 text-center">
        <p className="text-sm text-ink-700">{t('notCompleted')}</p>
        <Link
          href="/account/orders"
          className="mt-4 inline-block text-sm text-ink-900 underline underline-offset-4"
        >
          {t('backToOrders')}
        </Link>
      </div>
    )
  }

  return (
    <div>
      <Link
        href="/account/orders"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-taupe-600 hover:text-ink-900"
      >
        <ArrowLeft size={14} />
        {t('backToOrders')}
      </Link>

      <h2 className="text-lg tracking-[0.1em]">{t('heading', { orderNo: order.orderNo })}</h2>
      <p className="mt-2 text-xs text-taupe-500">{t('hint')}</p>

      <ul className="mt-8 space-y-5">
        {order.items.map((item) => {
          const existing = item.reviews[0]
          const productId = item.variant?.product.id

          return (
            <li key={item.id} className="border border-cream-200 bg-white p-5">
              <div className="flex items-center gap-3">
                <div className="relative size-16 shrink-0 overflow-hidden bg-cream-100">
                  {item.imageUrl && (
                    <Image src={item.imageUrl} alt="" fill sizes="64px" className="object-cover" />
                  )}
                </div>
                <div>
                  <p className="text-sm text-ink-900">{item.productName}</p>
                  <p className="mt-0.5 text-xs text-taupe-500">{item.variantName}</p>
                </div>
              </div>

              <div className="mt-4">
                {existing ? (
                  <p className="text-sm text-taupe-600">
                    {t('alreadyReviewed', { rating: existing.rating })}
                  </p>
                ) : productId ? (
                  <ReviewForm orderItemId={item.id} productId={productId} />
                ) : (
                  <p className="text-sm text-taupe-500">{t('productUnavailable')}</p>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
