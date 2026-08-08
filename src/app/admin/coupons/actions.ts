'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { audit } from '@/lib/audit'

export type CouponFormState = {
  ok: boolean
  message?: string
  error?: string
  fieldErrors?: Record<string, string>
}

const schema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(3, '折扣碼至少 3 個字元')
      .max(24)
      .regex(/^[A-Z0-9_-]+$/, '折扣碼只能使用英數、底線與連字號'),
    description: z.string().trim().max(100).optional().default(''),
    type: z.enum(['PERCENT', 'FIXED', 'FREE_SHIPPING']),
    value: z.coerce.number().int().min(0).max(1_000_000),
    minSubtotal: z.coerce.number().int().min(0).max(1_000_000),
    perUserLimit: z.coerce.number().int().min(1).max(100),
    usageLimit: z.string().optional().default(''),
    startsAt: z.string().optional().default(''),
    endsAt: z.string().optional().default(''),
  })
  .superRefine((data, ctx) => {
    if (data.type === 'PERCENT' && (data.value < 1 || data.value > 100)) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: '百分比折扣須介於 1 到 100' })
    }
    if (data.type === 'FIXED' && data.value < 1) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: '折抵金額須大於 0' })
    }
    if (data.startsAt && data.endsAt && new Date(data.startsAt) > new Date(data.endsAt)) {
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: '結束日期不能早於開始日期' })
    }
  })

export async function createCoupon(
  _prev: CouponFormState,
  formData: FormData,
): Promise<CouponFormState> {
  const admin = await requireAdmin()

  const parsed = schema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0] ?? '_')] ??= issue.message
    }
    return { ok: false, fieldErrors }
  }

  const data = parsed.data

  const existing = await db.coupon.findUnique({ where: { code: data.code } })
  if (existing) return { ok: false, fieldErrors: { code: '這個折扣碼已經存在' } }

  const coupon = await db.coupon.create({
    data: {
      code: data.code,
      description: data.description || null,
      type: data.type,
      // 免運折扣碼不需要 value
      value: data.type === 'FREE_SHIPPING' ? 0 : data.value,
      minSubtotal: data.minSubtotal,
      perUserLimit: data.perUserLimit,
      usageLimit: data.usageLimit ? Number.parseInt(data.usageLimit, 10) : null,
      startsAt: data.startsAt ? new Date(data.startsAt) : null,
      // 結束日期填的是日期，補到當天結束才符合直覺
      endsAt: data.endsAt ? new Date(`${data.endsAt}T23:59:59+08:00`) : null,
    },
  })

  await audit({
    userId: admin.id,
    action: 'coupon.create',
    entity: 'Coupon',
    entityId: coupon.id,
    after: data,
  })

  revalidatePath('/admin/coupons')
  return { ok: true, message: `折扣碼 ${coupon.code} 已建立` }
}

export async function toggleCoupon(
  couponId: string,
  isActive: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin()

  try {
    await db.coupon.update({ where: { id: couponId }, data: { isActive } })
    await audit({
      userId: admin.id,
      action: isActive ? 'coupon.enable' : 'coupon.disable',
      entity: 'Coupon',
      entityId: couponId,
    })
    revalidatePath('/admin/coupons')
    return { ok: true }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}
