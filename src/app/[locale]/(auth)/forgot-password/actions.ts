'use server'

import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { verifyOtp } from '@/lib/auth/otp'
import { hashPassword } from '@/lib/auth/password'
import { normalizeTwMobile } from '@/lib/sms/provider'

const schema = z
  .object({
    phone: z.string().trim().min(1),
    code: z.string().trim().min(4),
    password: z.string().min(8, 'passwordMin').max(128),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'passwordMismatch',
    path: ['confirmPassword'],
  })

export type ResetPasswordState = {
  ok: boolean
  error?: string
  fieldErrors?: Record<string, string>
  /** 成功後回正規化的號碼，讓前端拿它＋新密碼直接登入 */
  phone?: string
}

/**
 * 忘記密碼：用手機驗證碼重設。
 *
 * 這支是**未登入**也能呼叫的，安全性完全靠 OTP —— 所以驗證碼必須是
 * purpose='reset' 的那一組（login 的碼不能拿來重設密碼），而 verifyOtp
 * 本身有 5 分鐘效期、5 次嘗試上限與一次性消耗。
 *
 * 為什麼不「用簡訊登入之後再去改密碼」：帳號安全頁改密碼要驗舊密碼，
 * 而忘記密碼的人根本沒有舊密碼，那條路是死的。所以重設必須在這裡一次完成。
 */
export async function resetPasswordByOtp(formData: FormData): Promise<ResetPasswordState> {
  const parsed = schema.safeParse({
    phone: formData.get('phone'),
    code: formData.get('code'),
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  })

  if (!parsed.success) {
    const t = await getTranslations('validation')
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '_')
      // phone / code 的 min() 沒有對應的 validation key，統一收成一般錯誤
      if (key === 'phone' || key === 'code') continue
      fieldErrors[key] ??= t(issue.message)
    }
    if (Object.keys(fieldErrors).length === 0) {
      return { ok: false, error: (await getTranslations('errors'))('otpFieldsRequired') }
    }
    return { ok: false, fieldErrors }
  }

  const phone = normalizeTwMobile(parsed.data.phone)
  if (!phone) {
    return { ok: false, fieldErrors: { phone: (await getTranslations('validation'))('phoneInvalid') } }
  }

  const verified = await verifyOtp(phone, parsed.data.code, 'reset')
  if (!verified.ok) {
    return { ok: false, error: (await getTranslations('errors'))('otpInvalid') }
  }

  const passwordHash = await hashPassword(parsed.data.password)
  // updateMany：號碼在 schema 上唯一，但帳號可能在這幾分鐘內被刪掉，
  // 用 update 會拋 P2025。0 列就是查無此人。
  // sessionVersion +1：忘記密碼常常是因為密碼外洩，已經登入在別處的 session 一併作廢
  const { count } = await db.user.updateMany({
    where: { phone },
    data: { passwordHash, sessionVersion: { increment: 1 } },
  })
  if (count === 0) {
    return { ok: false, error: (await getTranslations('auth'))('resetNoAccount') }
  }

  return { ok: true, phone }
}
