'use server'

import { revalidatePath } from 'next/cache'
import type { ReviewStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { audit } from '@/lib/audit'

export async function moderateReview(
  reviewId: string,
  status: Extract<ReviewStatus, 'APPROVED' | 'REJECTED'>,
  rejectReason?: string,
): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin()

  try {
    const before = await db.review.findUniqueOrThrow({
      where: { id: reviewId },
      select: { status: true, productId: true, product: { select: { slug: true } } },
    })

    await db.review.update({
      where: { id: reviewId },
      data: {
        status,
        moderatedAt: new Date(),
        rejectReason: status === 'REJECTED' ? (rejectReason?.slice(0, 200) ?? null) : null,
      },
    })

    await audit({
      userId: admin.id,
      action: `review.${status.toLowerCase()}`,
      entity: 'Review',
      entityId: reviewId,
      before,
      after: { status },
    })

    revalidatePath('/admin/reviews')
    // 通過審核的評論要立刻出現在商品頁上
    revalidatePath(`/product/${before.product.slug}`)
    return { ok: true }
  } catch (error) {
    console.error('[admin] 審核評論失敗', error)
    return { ok: false, error: (error as Error).message }
  }
}
