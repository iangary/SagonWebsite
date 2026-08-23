import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { sendEmailVerification } from '@/lib/email'

/**
 * Email 註冊的一次性驗證信。
 *
 * 只在「第一次」發 —— 註冊當下寄一封，驗過就在 User.emailVerified 蓋時間戳，
 * 之後登入一律只靠密碼，不會再要驗證碼（手機 OTP 是另一條路，每次登入都發）。
 *
 * 沒驗證不擋登入：擋了會把「註冊完馬上結帳」的人卡在信箱前面，
 * 而這間店本來就允許訪客結帳。未驗證只是在會員中心顯示提示並提供重寄。
 */

/** 連結有效時間。比手機 OTP 的 5 分鐘長很多 —— 信可能進垃圾信匣，隔天才被看到。 */
export const EMAIL_VERIFY_TTL_HOURS = 24
/** 同一個信箱兩次索取之間的最短間隔 */
export const EMAIL_VERIFY_RESEND_COOLDOWN_SECONDS = 60
/** 同一個信箱每小時可索取的上限 */
export const EMAIL_VERIFY_HOURLY_LIMIT = 5

export type RequestEmailVerificationResult =
  | { ok: true; cooldownSeconds: number }
  | {
      ok: false
      reason: 'no_account' | 'already_verified' | 'cooldown' | 'rate_limited' | 'mail_failed'
      retryAfterSeconds?: number
    }

export type ConsumeEmailVerificationResult =
  | { ok: true; email: string; alreadyVerified: boolean }
  | { ok: false; reason: 'invalid' | 'expired' }

/**
 * token 的雜湊。SHA-256 而非 argon2 —— 理由見 schema 上 EmailVerification 的註解
 * （驗證時手上只有 token，必須用它反查那一列）。
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

function verifyUrlFor(token: string): string {
  return new URL(`/api/auth/verify-email?token=${token}`, env.APP_URL).toString()
}

/**
 * 產生並寄出驗證連結。
 *
 * 節流跟 OTP 一樣靠 DB（見 src/lib/auth/otp.ts 的理由）：本來就要寫一筆，
 * 多一個 count 查詢比維護 Redis 狀態單純。
 *
 * 呼叫端只有「註冊成功」與「會員中心按重寄」兩處，兩處都已知道這個信箱屬於誰，
 * 所以這裡可以直接回 no_account 而不必假裝寄出 —— 沒有帳號探測的問題。
 */
export async function requestEmailVerification(
  rawEmail: string,
): Promise<RequestEmailVerificationResult> {
  const email = normalizeEmail(rawEmail)
  if (!email) return { ok: false, reason: 'no_account' }

  const user = await db.user.findUnique({ where: { email }, select: { emailVerified: true } })
  if (!user) return { ok: false, reason: 'no_account' }
  if (user.emailVerified) return { ok: false, reason: 'already_verified' }

  const now = new Date()

  const latest = await db.emailVerification.findFirst({
    where: { email },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  if (latest) {
    const elapsed = (now.getTime() - latest.createdAt.getTime()) / 1000
    if (elapsed < EMAIL_VERIFY_RESEND_COOLDOWN_SECONDS) {
      return {
        ok: false,
        reason: 'cooldown',
        retryAfterSeconds: Math.ceil(EMAIL_VERIFY_RESEND_COOLDOWN_SECONDS - elapsed),
      }
    }
  }

  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000)
  const recentCount = await db.emailVerification.count({
    where: { email, createdAt: { gte: hourAgo } },
  })
  if (recentCount >= EMAIL_VERIFY_HOURLY_LIMIT) {
    return { ok: false, reason: 'rate_limited', retryAfterSeconds: 3600 }
  }

  // 32 bytes 的 CSPRNG 隨機值。base64url 可以直接放進 query string 不用再編碼。
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(now.getTime() + EMAIL_VERIFY_TTL_HOURS * 60 * 60 * 1000)

  // 舊連結一律作廢，同時只有最後一封信裡的那條有效
  await db.emailVerification.updateMany({
    where: { email, consumedAt: null },
    data: { consumedAt: now },
  })

  // 和 OTP 相反，這裡先寫再寄：連結必須查得到才有意義，寄成功了才建反而會有
  // 「信到了但連結不存在」的空窗。寄不出去就把這筆刪掉 ——
  // 沒有紀錄就沒有 cooldown，使用者可以立刻再按一次重寄。
  const record = await db.emailVerification.create({
    data: { email, tokenHash: hashToken(token), expiresAt },
  })

  try {
    await sendEmailVerification(email, verifyUrlFor(token), EMAIL_VERIFY_TTL_HOURS)
  } catch (err) {
    await db.emailVerification.delete({ where: { id: record.id } })
    console.error(`[email-verify] 驗證信寄送失敗 email=${maskEmail(email)}`, err)
    return { ok: false, reason: 'mail_failed' }
  }

  return { ok: true, cooldownSeconds: EMAIL_VERIFY_RESEND_COOLDOWN_SECONDS }
}

/**
 * 消耗驗證連結，成功就在 User.emailVerified 蓋時間戳。
 *
 * 同一條連結被打第二次是常態（信件掃描器預抓、使用者重整），
 * 所以已消耗但帳號確實已驗證的情況回 ok + alreadyVerified，不要顯示「連結無效」。
 */
export async function consumeEmailVerification(
  token: string,
): Promise<ConsumeEmailVerificationResult> {
  if (!token) return { ok: false, reason: 'invalid' }

  const record = await db.emailVerification.findUnique({
    where: { tokenHash: hashToken(token) },
  })
  if (!record) return { ok: false, reason: 'invalid' }

  if (record.consumedAt) {
    const user = await db.user.findUnique({
      where: { email: record.email },
      select: { emailVerified: true },
    })
    return user?.emailVerified
      ? { ok: true, email: record.email, alreadyVerified: true }
      : { ok: false, reason: 'invalid' }
  }

  const now = new Date()
  if (record.expiresAt < now) {
    await db.emailVerification.update({ where: { id: record.id }, data: { consumedAt: now } })
    return { ok: false, reason: 'expired' }
  }

  await db.$transaction([
    db.emailVerification.update({ where: { id: record.id }, data: { consumedAt: now } }),
    // updateMany 而不是 update：信寄出後帳號可能已被刪，這樣 0 列也不會拋錯
    db.user.updateMany({
      where: { email: record.email, emailVerified: null },
      data: { emailVerified: now },
    }),
  ])

  return { ok: true, email: record.email, alreadyVerified: false }
}

/** log 用。信箱是個資，不整串寫進 log（對齊 maskMobile 的做法）。 */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@')
  const head = local.slice(0, 2)
  return `${head}${'*'.repeat(Math.max(local.length - 2, 1))}@${domain}`
}
