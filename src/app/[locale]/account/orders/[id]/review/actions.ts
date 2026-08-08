'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'

const schema = z.object({
  orderItemId: z.string().min(1),
  productId: z.string().min(1),
  rating: z.coerce.number().int().min(1, '請選擇評分').max(5),
  title: z.string().trim().max(100).optional().default(''),
  body: z.string().trim().min(5, '評論至少 5 個字').max(2000),
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
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0] ?? '_')] ??= issue.message
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
    return { ok: false, error: '找不到對應的購買紀錄，或訂單尚未完成' }
  }
  if (orderItem.variant?.productId !== data.productId) {
    return { ok: false, error: '商品資料不符' }
  }

  const existing = await db.review.findUnique({
    where: { orderItemId: data.orderItemId },
    select: { id: true },
  })
  if (existing) return { ok: false, error: '這個項目已經評論過了' }

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
  return { ok: true, message: '評論已送出，通過審核後就會顯示在商品頁' }
}
