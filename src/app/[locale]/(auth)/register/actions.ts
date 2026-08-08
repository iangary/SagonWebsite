'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth/password'
import { normalizeTwMobile } from '@/lib/sms/provider'

const schema = z
  .object({
    name: z.string().trim().min(1, '請輸入姓名').max(50),
    email: z.string().trim().toLowerCase().email('請輸入正確的 Email'),
    phone: z.string().trim().optional().default(''),
    password: z.string().min(8, '密碼至少 8 個字元').max(128),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: '兩次輸入的密碼不一致',
    path: ['confirmPassword'],
  })

export type RegisterState = {
  ok: boolean
  error?: string
  fieldErrors?: Record<string, string>
}

export async function registerAction(
  _prev: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const parsed = schema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    phone: formData.get('phone') ?? '',
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  })

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '_')
      fieldErrors[key] ??= issue.message
    }
    return { ok: false, fieldErrors }
  }

  const { name, email, password } = parsed.data

  let phone: string | null = null
  if (parsed.data.phone) {
    phone = normalizeTwMobile(parsed.data.phone)
    if (!phone) {
      return { ok: false, fieldErrors: { phone: '請輸入正確的台灣手機號碼' } }
    }
    const phoneTaken = await db.user.findUnique({ where: { phone }, select: { id: true } })
    if (phoneTaken) {
      return { ok: false, fieldErrors: { phone: '這支手機號碼已被註冊' } }
    }
  }

  const existing = await db.user.findUnique({ where: { email } })

  if (existing?.passwordHash) {
    return { ok: false, fieldErrors: { email: '這個 Email 已經註冊過了，請直接登入' } }
  }

  const passwordHash = await hashPassword(password)

  if (existing) {
    // 這個 Email 已經用 Google 登入過。補上密碼，等於把兩種登入方式綁在同一個帳號，
    // 而不是另開一個重複的會員。
    await db.user.update({
      where: { id: existing.id },
      data: {
        passwordHash,
        name: existing.name ?? name,
        ...(phone ? { phone } : {}),
      },
    })
    return { ok: true }
  }

  await db.user.create({
    data: { name, email, passwordHash, phone },
  })

  return { ok: true }
}
