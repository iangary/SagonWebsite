import { useLocale, useTranslations } from 'next-intl'
import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'

type Review = {
  id: string
  rating: number
  title: string | null
  body: string
  createdAt: Date
  user: { name: string | null; image: string | null }
}

/** 顯示名稱只留姓氏加星號，避免把會員全名公開出去 */
function maskName(name: string | null, anonymous: string): string {
  if (!name) return anonymous
  if (name.length <= 1) return name
  return `${name[0]}${'*'.repeat(Math.min(name.length - 1, 2))}`
}

export function Stars({ rating, size = 14 }: { rating: number; size?: number }) {
  const t = useTranslations('reviews')
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={t('ratingLabel', { rating })}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          aria-hidden
          className={cn(
            n <= rating ? 'fill-rose-accent text-rose-accent' : 'fill-transparent text-cream-300',
          )}
        />
      ))}
    </span>
  )
}

/**
 * average / total 一律由伺服器端的 getProductReviewStats 給，不在這裡算。
 *
 * reviews 只是「最新的前 20 則」，拿它算平均會得到跟 Google 收到的
 * aggregateRating 不一樣的數字（見 queries.ts 的 getProductReviewStats）。
 */
export function ProductReviews({
  reviews,
  average,
  total,
  labels,
}: {
  productId: string
  reviews: Review[]
  average: number
  total: number
  labels: { title: string; empty: string }
}) {
  const t = useTranslations('reviews')
  const locale = useLocale()

  return (
    <section className="mt-20 border-t border-cream-200 pt-10">
      <div className="flex flex-wrap items-baseline gap-4">
        <h2 className="text-lg tracking-[0.12em]">{labels.title}</h2>
        {total > 0 && (
          <p className="flex items-center gap-2 text-sm text-taupe-600">
            <Stars rating={Math.round(average)} />
            <span className="tabular-nums">{average}</span>
            <span>{t('count', { count: total })}</span>
          </p>
        )}
      </div>

      {reviews.length === 0 ? (
        <p className="mt-6 text-sm text-taupe-500">{labels.empty}</p>
      ) : (
        <ul className="mt-8 max-w-3xl divide-y divide-cream-200">
          {reviews.map((review) => (
            <li key={review.id} className="py-6 first:pt-0">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Stars rating={review.rating} />
                  <span className="text-sm text-ink-900">
                    {maskName(review.user.name, t('anonymous'))}
                  </span>
                </div>
                <time
                  dateTime={review.createdAt.toISOString()}
                  className="text-xs text-taupe-400"
                >
                  {review.createdAt.toLocaleDateString(locale)}
                </time>
              </div>
              {review.title && <p className="mt-3 text-sm text-ink-900">{review.title}</p>}
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-700">
                {review.body}
              </p>
            </li>
          ))}
        </ul>
      )}

      {total > reviews.length && (
        <p className="mt-6 text-xs text-taupe-500">
          {t('showingLatest', { shown: reviews.length, total })}
        </p>
      )}

      <p className="mt-8 text-xs text-taupe-500">{t('cta')}</p>
    </section>
  )
}
