import 'server-only'
import { randomInt } from 'node:crypto'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { getSmsProvider, normalizeTwMobile } from '@/lib/sms/provider'
import { hashPassword, verifyPassword } from './password'

export const OTP_TTL_MINUTES = 5
export const OTP_MAX_ATTEMPTS = 5
/** 同一支號碼兩次索取之間的最短間隔 */
export const OTP_RESEND_COOLDOWN_SECONDS = 60
/** 同一支號碼每小時可索取的上限 */
export const OTP_HOURLY_LIMIT = 5

export type OtpPurpose = 'login' | 'bind'

export type RequestOtpResult =
  | { ok: true; cooldownSeconds: number; devCode?: string }
  | { ok: false; reason: 'invalid_phone' | 'cooldown' | 'rate_limited'; retryAfterSeconds?: number }

export type VerifyOtpResult =
  | { ok: true; phone: string }
  | { ok: false; reason: 'invalid_phone' | 'not_found' | 'expired' | 'too_many_attempts' | 'mismatch' }

/**
 * 產生並寄出 OTP。
 *
 * 節流靠 DB 而非 Redis：OTP 的量很小，而且 PhoneOtp 本來就要寫一筆，
 * 多一個 count 查詢比多維護一份 Redis 狀態單純，也不會因為 Redis 掉了就變成無限制。
 */
export async function requestOtp(rawPhone: string, purpose: OtpPurpose = 'login'): Promise<RequestOtpResult> {
  const phone = normalizeTwMobile(rawPhone)
  if (!phone) return { ok: false, reason: 'invalid_phone' }

  const now = new Date()

  const latest = await db.phoneOtp.findFirst({
    where: { phone, purpose },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  if (latest) {
    const elapsed = (now.getTime() - latest.createdAt.getTime()) / 1000
    if (elapsed < OTP_RESEND_COOLDOWN_SECONDS) {
      return {
        ok: false,
        reason: 'cooldown',
        retryAfterSeconds: Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - elapsed),
      }
    }
  }

  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000)
  const recentCount = await db.phoneOtp.count({
    where: { phone, createdAt: { gte: hourAgo } },
  })
  if (recentCount >= OTP_HOURLY_LIMIT) {
    return { ok: false, reason: 'rate_limited', retryAfterSeconds: 3600 }
  }

  // randomInt 是 CSPRNG；Math.random 不能拿來產驗證碼
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const codeHash = await hashPassword(code)
  const expiresAt = new Date(now.getTime() + OTP_TTL_MINUTES * 60 * 1000)

  // 同號碼的舊碼一律作廢，避免多組碼同時有效
  await db.phoneOtp.updateMany({
    where: { phone, purpose, consumedAt: null },
    data: { consumedAt: now },
  })

  const provider = getSmsProvider()
  const text = `【${env.SHOP_NAME}】您的驗證碼是 ${code}，${OTP_TTL_MINUTES} 分鐘內有效。請勿轉傳給他人。`
  const sent = await provider.send(phone, text)

  await db.phoneOtp.create({
    data: {
      phone,
      purpose,
      codeHash,
      expiresAt,
      // 只有 console provider 會留明碼，正式環境的 provider 不回傳 devEcho
      devCode: sent.devEcho ? code : null,
    },
  })

  return {
    ok: true,
    cooldownSeconds: OTP_RESEND_COOLDOWN_SECONDS,
    ...(sent.devEcho ? { devCode: code } : {}),
  }
}

/** 驗證 OTP。成功後該筆立即標記為已使用，不能重放。 */
export async function verifyOtp(
  rawPhone: string,
  code: string,
  purpose: OtpPurpose = 'login',
): Promise<VerifyOtpResult> {
  const phone = normalizeTwMobile(rawPhone)
  if (!phone) return { ok: false, reason: 'invalid_phone' }

  const record = await db.phoneOtp.findFirst({
    where: { phone, purpose, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  })
  if (!record) return { ok: false, reason: 'not_found' }

  if (record.expiresAt < new Date()) {
    await db.phoneOtp.update({ where: { id: record.id }, data: { consumedAt: new Date() } })
    return { ok: false, reason: 'expired' }
  }

  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    await db.phoneOtp.update({ where: { id: record.id }, data: { consumedAt: new Date() } })
    return { ok: false, reason: 'too_many_attempts' }
  }

  const matched = await verifyPassword(record.codeHash, code.trim())
  if (!matched) {
    await db.phoneOtp.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    })
    return { ok: false, reason: 'mismatch' }
  }

  await db.phoneOtp.update({
    where: { id: record.id },
    data: { consumedAt: new Date(), devCode: null },
  })
  return { ok: true, phone }
}
