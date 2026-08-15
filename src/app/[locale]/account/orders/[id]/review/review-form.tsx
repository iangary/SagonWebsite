'use client'

import * as React from 'react'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Textarea, Field } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { submitReview, type ReviewState } from './actions'

const INITIAL: ReviewState = { ok: false }

export function ReviewForm({
  orderItemId,
  productId,
}: {
  orderItemId: string
  productId: string
}) {
  const t = useTranslations('review')
  const { toast } = useToast()
  const router = useRouter()
  const [state, formAction, pending] = useActionState(submitReview, INITIAL)
  const [rating, setRating] = React.useState(5)
  const [hovered, setHovered] = React.useState(0)

  React.useEffect(() => {
    if (state.ok && state.message) {
      toast(state.message)
      router.refresh()
    }
    if (state.error) toast(state.error, 'error')
  }, [state, toast, router])

  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="orderItemId" value={orderItemId} />
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="rating" value={rating} />

      <div>
        <span className="mb-2 block text-xs tracking-wide text-taupe-600">
          {t('rating')} <span className="text-sale">*</span>
        </span>
        <div className="flex gap-1" onMouseLeave={() => setHovered(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              onMouseEnter={() => setHovered(n)}
              aria-label={t('ratingStar', { n })}
              aria-pressed={rating === n}
              className="p-0.5"
            >
              <Star
                size={22}
                className={cn(
                  'transition-colors',
                  n <= (hovered || rating)
                    ? 'fill-rose-accent text-rose-accent'
                    : 'fill-transparent text-cream-300',
                )}
              />
            </button>
          ))}
        </div>
        {errors.rating && <p className="mt-1 text-xs text-sale">{errors.rating}</p>}
      </div>

      <Field label={t('titleField')} htmlFor={`title-${orderItemId}`}>
        <Input
          id={`title-${orderItemId}`}
          name="title"
          maxLength={100}
          placeholder={t('titlePlaceholder')}
        />
      </Field>

      <Field label={t('body')} htmlFor={`body-${orderItemId}`} required error={errors.body}>
        <Textarea
          id={`body-${orderItemId}`}
          name="body"
          maxLength={2000}
          placeholder={t('bodyPlaceholder')}
          required
        />
      </Field>

      <Button type="submit" disabled={pending}>
        {pending ? t('submitting') : t('submit')}
      </Button>
    </form>
  )
}
