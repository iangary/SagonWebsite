'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { verifyOtp } from '@/lib/auth/otp'
import { normalizeTwMobile } from '@/lib/sms/provider'

export type ActionState = {
  ok: boolean
  message?: string
  error?: string
  fieldErrors?: Record<string, string>
}

function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) out[String(issue.path[0] ?? '_')] ??= issue.message
  return out
}

// ---------------------------------------------------------------------------
// 個人資料
// ---------------------------------------------------------------------------

const profileSchema = z.object({
  name: z.string().trim().min(1, '請輸入姓名').max(50),
})

export async function updateProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser()

  const parsed = profileSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) }

  await db.user.update({ where: { id: user.id }, data: { name: parsed.data.name } })
  revalidatePath('/account/profile')
  return { ok: true, message: '個人資料已更新' }
}

// ---------------------------------------------------------------------------
// 地址簿
// ---------------------------------------------------------------------------

const addressSchema = z.object({
  id: z.string().optional().default(''),
  recipient: z.string().trim().min(1, '請輸入收件人').max(50),
  phone: z.string().trim().min(1, '請輸入手機號碼'),
  zip: z.string().trim().regex(/^\d{3,5}$/, '郵遞區號格式不正確'),
  city: z.string().trim().min(1, '請選擇縣市'),
  district: z.string().trim().min(1, '請輸入鄉鎮市區'),
  line1: z.string().trim().min(1, '請輸入詳細地址').max(200),
  isDefault: z.string().optional().default(''),
})

export async function saveAddress(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser()

  const parsed = addressSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) }

  const phone = normalizeTwMobile(parsed.data.phone)
  if (!phone) return { ok: false, fieldErrors: { phone: '請輸入正確的台灣手機號碼' } }

  const { id, isDefault, ...rest } = parsed.data
  const makeDefault = isDefault === 'on' || isDefault === 'true'

  await db.$transaction(async (tx) => {
    // 一個會員只能有一個預設地址
    if (makeDefault) {
      await tx.address.updateMany({ where: { userId: user.id }, data: { isDefault: false } })
    }

    if (id) {
      // where 帶上 userId，避免有人竄改 id 去改到別人的地址
      const owned = await tx.address.findFirst({
        where: { id, userId: user.id },
        select: { id: true },
      })
      if (!owned) throw new Error('找不到這筆地址')

      await tx.address.update({
        where: { id },
        data: { ...rest, phone, isDefault: makeDefault },
      })
    } else {
      const count = await tx.address.count({ where: { userId: user.id } })
      await tx.address.create({
        data: {
          ...rest,
          phone,
          userId: user.id,
          // 第一筆地址自動設為預設
          isDefault: makeDefault || count === 0,
        },
      })
    }
  })

  revalidatePath('/account/addresses')
  return { ok: true, message: id ? '地址已更新' : '地址已新增' }
}

export async function deleteAddress(addressId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser()

  const address = await db.address.findFirst({
    where: { id: addressId, userId: user.id },
    select: { id: true, isDefault: true },
  })
  if (!address) return { ok: false, error: '找不到這筆地址' }

  await db.address.delete({ where: { id: addressId } })

  // 刪掉預設地址後，把剩下最早建立的那筆補成預設
  if (address.isDefault) {
    const next = await db.address.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
    if (next) await db.address.update({ where: { id: next.id }, data: { isDefault: true } })
  }

  revalidatePath('/account/addresses')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// 帳號安全
// ---------------------------------------------------------------------------

const passwordSchema = z
  .object({
    currentPassword: z.string().optional().default(''),
    newPassword: z.string().min(8, '密碼至少 8 個字元').max(128),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: '兩次輸入的密碼不一致',
    path: ['confirmPassword'],
  })

export async function setPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const sessionUser = await requireUser()

  const parsed = passwordSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) }

  const user = await db.user.findUniqueOrThrow({
    where: { id: sessionUser.id },
    select: { passwordHash: true },
  })

  // 已經有密碼的人要先驗證舊密碼，才不會被 session 劫持者直接改掉
  if (user.passwordHash) {
    const ok = await verifyPassword(user.passwordHash, parsed.data.currentPassword)
    if (!ok) return { ok: false, fieldErrors: { currentPassword: '目前密碼不正確' } }
  }

  await db.user.update({
    where: { id: sessionUser.id },
    data: { passwordHash: await hashPassword(parsed.data.newPassword) },
  })

  revalidatePath('/account/security')
  return { ok: true, message: user.passwordHash ? '密碼已變更' : '密碼已設定' }
}

const bindPhoneSchema = z.object({
  phone: z.string().trim().min(1),
  code: z.string().trim().min(4),
})

export async function bindPhone(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const sessionUser = await requireUser()

  const parsed = bindPhoneSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { ok: false, error: '請輸入手機號碼與驗證碼' }

  const result = await verifyOtp(parsed.data.phone, parsed.data.code, 'bind')
  if (!result.ok) return { ok: false, error: '驗證碼錯誤或已過期' }

  const taken = await db.user.findUnique({
    where: { phone: result.phone },
    select: { id: true },
  })
  if (taken && taken.id !== sessionUser.id) {
    return { ok: false, error: '這支手機號碼已被其他帳號綁定' }
  }

  await db.user.update({
    where: { id: sessionUser.id },
    data: { phone: result.phone, phoneVerified: new Date() },
  })

  revalidatePath('/account/security')
  return { ok: true, message: '手機已驗證綁定' }
}

/**
 * 解除第三方登入綁定。
 * 解除前確認至少還留一種能登入的方式，否則會把自己鎖在門外。
 */
export async function unlinkProvider(provider: string): Promise<{ ok: boolean; error?: string }> {
  const sessionUser = await requireUser()

  const user = await db.user.findUniqueOrThrow({
    where: { id: sessionUser.id },
    select: {
      passwordHash: true,
      phone: true,
      phoneVerified: true,
      accounts: { select: { id: true, provider: true } },
    },
  })

  const target = user.accounts.filter((a) => a.provider === provider)
  if (target.length === 0) return { ok: false, error: '沒有綁定這個登入方式' }

  const remainingMethods =
    user.accounts.filter((a) => a.provider !== provider).length +
    (user.passwordHash ? 1 : 0) +
    (user.phone && user.phoneVerified ? 1 : 0)

  if (remainingMethods === 0) {
    return {
      ok: false,
      error: '這是您唯一的登入方式，請先設定密碼或綁定手機再解除',
    }
  }

  await db.account.deleteMany({ where: { userId: sessionUser.id, provider } })

  revalidatePath('/account/security')
  return { ok: true }
}
