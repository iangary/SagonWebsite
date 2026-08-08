import { notFound } from 'next/navigation'
import Image from 'next/image'
import { ArrowLeft } from 'lucide-react'
import { Link } from '@/i18n/routing'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { ReviewForm } from './review-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: '撰寫評論', robots: { index: false } }

export default async function WriteReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await requireUser()

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
        <p className="text-sm text-ink-700">訂單完成後才能撰寫評論。</p>
        <Link
          href="/account/orders"
          className="mt-4 inline-block text-sm text-ink-900 underline underline-offset-4"
        >
          回我的訂單
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
        回我的訂單
      </Link>

      <h2 className="text-lg tracking-[0.1em]">為訂單 {order.orderNo} 的商品留下評論</h2>
      <p className="mt-2 text-xs text-taupe-500">
        評論送出後需經審核才會公開顯示。每個購買項目只能評論一次。
      </p>

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
                    您已評論過這個項目（{existing.rating} 分）。
                  </p>
                ) : productId ? (
                  <ReviewForm orderItemId={item.id} productId={productId} />
                ) : (
                  <p className="text-sm text-taupe-500">這個商品已下架，無法評論。</p>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
