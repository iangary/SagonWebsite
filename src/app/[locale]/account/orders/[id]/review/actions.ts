'use server'

import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

const schema = z.object({
  orderItemId: z.string().min(1),
  productId: z.string().min(1),
  rating: z.coerce.number().int().min(1, 'ratingRequired').max(5),
  title: z.string().trim().max(100).optional().default(''),
  body: z.string().trim().min(5, 'reviewBodyMin').max(2000),
})

export type ReviewState = {
  ok: boolean
  message?: string
  error?: string
  fieldErrors?: Record<string, string>
}

export async function submitReview(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const user = await requireUser()

  const parsed = schema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) {
    const t = await getTranslations('validation')
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0] ?? '_')] ??= t(issue.message)
    }
    return { ok: false, fieldErrors }
  }

  const data = parsed.data

  // 驗證這個購買項目確實屬於本人、而且訂單已完成 ——
  // 沒有這一步，任何人都能對任意商品灌評論。
  const orderItem = await db.orderItem.findFirst({
    where: {
      id: data.orderItemId,
      order: { userId: user.id, status: 'COMPLETED' },
    },
    select: { id: true, variant: { select: { productId: true } } },
  })

  if (!orderItem) {
    return { ok: false, error: (await getTranslations('errors'))('purchaseNotFound') }
  }
  if (orderItem.variant?.productId !== data.productId) {
    return { ok: false, error: (await getTranslations('errors'))('productMismatch') }
  }

  const existing = await db.review.findUnique({
    where: { orderItemId: data.orderItemId },
    select: { id: true },
  })
  if (existing) return { ok: false, error: (await getTranslations('errors'))('alreadyReviewed') }

  await db.review.create({
    data: {
      productId: data.productId,
      userId: user.id,
      orderItemId: data.orderItemId,
      rating: data.rating,
      title: data.title || null,
      body: data.body,
      status: 'PENDING',
    },
  })

  revalidatePath('/account/orders')
  return { ok: true, message: (await getTranslations('review'))('submitted') }
}
