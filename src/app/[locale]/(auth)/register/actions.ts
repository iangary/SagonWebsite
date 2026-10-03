'use server'

import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth/password'
import { maskEmail, requestEmailVerification } from '@/lib/auth/email-verification'
import { normalizeTwMobile } from '@/lib/sms/provider'
import { clientIp, consumeRateLimit } from '@/lib/rate-limit'

/** 同一個 IP 每小時最多送出幾次註冊（每次都可能寄一封驗證信，也能拿來探測哪些 Email 是會員） */
const REGISTER_PER_IP_HOURLY = 10

const schema = z
  .object({
    // 訊息存的是 messages 的 validation.* key，回應時才翻。
    name: z.string().trim().min(1, 'nameRequired').max(50),
    email: z.string().trim().toLowerCase().email('emailInvalid'),
    phone: z.string().trim().optional().default(''),
    password: z.string().min(8, 'passwordMin').max(128),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'passwordMismatch',
    path: ['confirmPassword'],
  })

async function validation(key: string): Promise<string> {
  return (await getTranslations('validation'))(key)
}

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
    const t = await getTranslations('validation')
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '_')
      fieldErrors[key] ??= t(issue.message)
    }
    return { ok: false, fieldErrors }
  }

  const limited = await consumeRateLimit(
    `register:ip:${clientIp(await headers())}`,
    REGISTER_PER_IP_HOURLY,
    3600,
  )
  if (!limited.ok) return { ok: false, error: (await getTranslations('errors'))('tooManyRequests') }

  const { name, email, password } = parsed.data

  let phone: string | null = null
  if (parsed.data.phone) {
    phone = normalizeTwMobile(parsed.data.phone)
    if (!phone) {
      return { ok: false, fieldErrors: { phone: await validation('phoneInvalid') } }
    }
    const phoneTaken = await db.user.findUnique({ where: { phone }, select: { id: true } })
    if (phoneTaken) {
      return { ok: false, fieldErrors: { phone: (await getTranslations('errors'))('phoneTaken2') } }
    }
  }

  const existing = await db.user.findUnique({ where: { email } })

  if (existing?.passwordHash) {
    return { ok: false, fieldErrors: { email: (await getTranslations('errors'))('emailTaken') } }
  }

  /**
   * 這個 Email 已經用 Google／LINE／Facebook 登入過、但沒設過密碼。
   *
   * 這裡**絕對不能**順手把密碼寫進去：註冊頁不需要登入，填表的人不一定是信箱主人。
   * 以前就是這樣寫的，結果只要知道別人的 Gmail，就能替那個帳號設一組自己的密碼、
   * 直接登進去看訂單與地址（驗證信是事後才寄，密碼登入也不看 emailVerified）。
   *
   * 本人想加一組密碼，正確的路是用原本的方式登入，再到「帳號安全」設定 ——
   * 那裡有 session 證明身分（見 account/actions.ts 的 setPassword）。
   */
  if (existing) {
    return { ok: false, fieldErrors: { email: (await getTranslations('errors'))('emailTakenSso') } }
  }

  const passwordHash = await hashPassword(password)

  await db.user.create({
    data: { name, email, passwordHash, phone },
  })

  await sendVerification(email)
  return { ok: true }
}

/**
 * 註冊當下寄一次驗證信 —— 只有這一次會發，驗過就不再發（見 lib/auth/email-verification.ts）。
 *
 * 寄不出去不擋註冊：SMTP 掛掉不是使用者的錯，而且未驗證本來就不影響登入與購買。
 * 會員中心會顯示「尚未驗證」並提供重寄，所以這裡失敗只留 log。
 */
async function sendVerification(email: string): Promise<void> {
  const result = await requestEmailVerification(email)
  if (!result.ok && result.reason !== 'already_verified') {
    console.error(`[register] 驗證信未寄出 email=${maskEmail(email)} reason=${result.reason}`)
  }
}
