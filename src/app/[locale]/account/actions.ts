'use server'

import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
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

/**
 * 訊息跟著使用者的語系走。Server Action 由 proxy 的 next-intl middleware
 * 標好語系後才進來，所以這裡拿得到正確的 locale。
 */
async function error(key: string): Promise<string> {
  return (await getTranslations('errors'))(key)
}

async function validation(key: string): Promise<string> {
  return (await getTranslations('validation'))(key)
}

/**
 * zod 的 message 存的是 messages 的 validation.* key ——
 * schema 是模組層級的常數，建立時還沒有請求，拿不到語系。
 */
async function fieldErrorsFrom(zodError: z.ZodError): Promise<Record<string, string>> {
  const t = await getTranslations('validation')
  const out: Record<string, string> = {}
  for (const issue of zodError.issues) out[String(issue.path[0] ?? '_')] ??= t(issue.message)
  return out
}

// ---------------------------------------------------------------------------
// 個人資料
// ---------------------------------------------------------------------------

const profileSchema = z.object({
  name: z.string().trim().min(1, 'nameRequired').max(50),
})

export async function updateProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser()

  const parsed = profileSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { ok: false, fieldErrors: await fieldErrorsFrom(parsed.error) }

  await db.user.update({ where: { id: user.id }, data: { name: parsed.data.name } })
  revalidatePath('/account/profile')
  return { ok: true, message: (await getTranslations('account'))('profileUpdated') }
}

// ---------------------------------------------------------------------------
// 地址簿
// ---------------------------------------------------------------------------

const addressSchema = z.object({
  id: z.string().optional().default(''),
  recipient: z.string().trim().min(1, 'recipientRequired').max(50),
  phone: z.string().trim().min(1, 'phoneRequired'),
  zip: z.string().trim().regex(/^\d{3,5}$/, 'zipFormat'),
  city: z.string().trim().min(1, 'cityRequired'),
  district: z.string().trim().min(1, 'districtRequired'),
  line1: z.string().trim().min(1, 'addressLineRequired').max(200),
  isDefault: z.string().optional().default(''),
})

export async function saveAddress(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser()

  const parsed = addressSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { ok: false, fieldErrors: await fieldErrorsFrom(parsed.error) }

  const phone = normalizeTwMobile(parsed.data.phone)
  if (!phone) {
    return { ok: false, fieldErrors: { phone: await validation('phoneInvalid') } }
  }

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
      if (!owned) throw new Error('address not found')

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

  const tAccount = await getTranslations('account')
  revalidatePath('/account/addresses')
  return { ok: true, message: tAccount(id ? 'addressUpdated' : 'addressAdded') }
}

export async function deleteAddress(addressId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser()

  const address = await db.address.findFirst({
    where: { id: addressId, userId: user.id },
    select: { id: true, isDefault: true },
  })
  if (!address) return { ok: false, error: await error('addressNotFound') }

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
    newPassword: z.string().min(8, 'passwordMin').max(128),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'passwordMismatch',
    path: ['confirmPassword'],
  })

export async function setPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const sessionUser = await requireUser()

  const parsed = passwordSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { ok: false, fieldErrors: await fieldErrorsFrom(parsed.error) }

  const user = await db.user.findUniqueOrThrow({
    where: { id: sessionUser.id },
    select: { passwordHash: true },
  })

  // 已經有密碼的人要先驗證舊密碼，才不會被 session 劫持者直接改掉
  if (user.passwordHash) {
    const ok = await verifyPassword(user.passwordHash, parsed.data.currentPassword)
    if (!ok) {
      return { ok: false, fieldErrors: { currentPassword: await error('currentPasswordWrong') } }
    }
  }

  await db.user.update({
    where: { id: sessionUser.id },
    data: { passwordHash: await hashPassword(parsed.data.newPassword) },
  })

  const tAccount = await getTranslations('account')
  revalidatePath('/account/security')
  return {
    ok: true,
    message: tAccount(user.passwordHash ? 'passwordChanged' : 'passwordCreated'),
  }
}

const bindPhoneSchema = z.object({
  phone: z.string().trim().min(1),
  code: z.string().trim().min(4),
})

export async function bindPhone(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const sessionUser = await requireUser()

  const parsed = bindPhoneSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { ok: false, error: await error('otpFieldsRequired') }

  const result = await verifyOtp(parsed.data.phone, parsed.data.code, 'bind')
  if (!result.ok) return { ok: false, error: await error('otpInvalid') }

  const taken = await db.user.findUnique({
    where: { phone: result.phone },
    select: { id: true },
  })
  if (taken && taken.id !== sessionUser.id) {
    return { ok: false, error: await error('phoneTaken') }
  }

  await db.user.update({
    where: { id: sessionUser.id },
    data: { phone: result.phone, phoneVerified: new Date() },
  })

  revalidatePath('/account/security')
  return { ok: true, message: (await getTranslations('account'))('phoneBound') }
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
  if (target.length === 0) return { ok: false, error: await error('providerNotLinked') }

  const remainingMethods =
    user.accounts.filter((a) => a.provider !== provider).length +
    (user.passwordHash ? 1 : 0) +
    (user.phone && user.phoneVerified ? 1 : 0)

  if (remainingMethods === 0) {
    return { ok: false, error: await error('lastLoginMethod') }
  }

  await db.account.deleteMany({ where: { userId: sessionUser.id, provider } })

  revalidatePath('/account/security')
  return { ok: true }
}
