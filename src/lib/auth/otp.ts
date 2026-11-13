import 'server-only'
import { randomInt, randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { getSmsProvider, maskMobile, normalizeTwMobile } from '@/lib/sms/provider'
import { hashPassword, verifyPassword } from './password'

export const OTP_TTL_MINUTES = 5
export const OTP_MAX_ATTEMPTS = 5
/** 同一支號碼兩次索取之間的最短間隔 */
export const OTP_RESEND_COOLDOWN_SECONDS = 60
/** 同一支號碼每小時可索取的上限 */
export const OTP_HOURLY_LIMIT = 5

/**
 * login：手機驗證碼登入（等同註冊）。**只有還沒設密碼的號碼才發** —— 見 requestOtp。
 * bind：已登入的會員在帳號安全頁綁定／更換號碼。
 * reset：忘記密碼。已設密碼的人唯一還會收到簡訊的路徑。
 */
export type OtpPurpose = 'login' | 'bind' | 'reset'

export type RequestOtpResult =
  | { ok: true; cooldownSeconds: number; devCode?: string }
  | {
      ok: false
      reason: 'invalid_phone' | 'use_password' | 'no_account' | 'cooldown' | 'rate_limited' | 'sms_failed'
      retryAfterSeconds?: number
    }

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

  const denied = await checkPurposePolicy(phone, purpose)
  if (denied) return denied

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

  // 全站上限：每支號碼的上限擋不住輪流換號碼的刷法，簡訊費得有個天花板
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const dailyCount = await db.phoneOtp.count({ where: { createdAt: { gte: dayAgo } } })
  if (dailyCount >= env.SMS_DAILY_LIMIT) {
    console.error(`[otp] 全站 24 小時簡訊已達上限 ${env.SMS_DAILY_LIMIT} 則，暫停發送`)
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

  // 每次 requestOtp() 都是一次獨立的索取（60 秒 cooldown 擋掉連點），所以要換新的
  // clientid —— 沿用舊的會讓三竹判定重複、直接回上次結果而不真的發第二則簡訊。
  // 反之，若日後在 provider 內加自動重試，那圈重試必須沿用同一個 clientid。
  const clientId = randomUUID()

  let sent
  try {
    sent = await provider.send(phone, text, clientId)
  } catch (err) {
    // 簡訊送不出去不是使用者的錯，不要讓它變成 500。
    // 這裡刻意不寫 PhoneOtp：沒有紀錄就沒有 cooldown，使用者可以立刻再試一次。
    console.error(`[otp] 簡訊發送失敗 phone=${maskMobile(phone)} clientid=${clientId}`, err)
    return { ok: false, reason: 'sms_failed' }
  }

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

/**
 * 「驗證碼只在第一次發」的規則就在這裡。
 *
 * 簡訊每則都要錢，所以已經設過密碼的號碼平常一律不發：登入走密碼，
 * 真的忘記密碼才用 purpose='reset' 再要一次碼（那條路才是例外）。
 *
 * 副作用是回應會透露「這支號碼有沒有帳號、有沒有密碼」。這是刻意接受的 ——
 * 註冊表單早就會說「這個 Email 已經註冊過了」，而不講清楚的話使用者只會
 * 一直按重寄然後以為系統壞了。
 */
async function checkPurposePolicy(
  phone: string,
  purpose: OtpPurpose,
): Promise<RequestOtpResult | null> {
  // 綁定是已登入會員在自己帳號頁上的操作，不受這條規則限制
  if (purpose === 'bind') return null

  const user = await db.user.findUnique({ where: { phone }, select: { passwordHash: true } })

  if (purpose === 'login') {
    // 沒有帳號 = 第一次（發碼即註冊）；有帳號但還沒設密碼也要放行，
    // 否則他連進站設密碼的門都沒有。
    return user?.passwordHash ? { ok: false, reason: 'use_password' } : null
  }

  // reset：沒有帳號就沒有密碼可重設，發了也是白花錢
  return user ? null : { ok: false, reason: 'no_account' }
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

  /**
   * 先佔一次嘗試額度，佔到了才比對。
   *
   * 以前是「讀 attempts → 跑 argon2 → 失敗才 +1」，並行送出時每個請求都讀到同一個舊值，
   * 5 次上限形同虛設，可以在 5 分鐘內並行猜碼（忘記密碼那條路猜中就能重設密碼）。
   * 條件式 updateMany 在資料庫裡是原子的：第 6 個請求一定拿到 count 0。
   */
  const claimed = await db.phoneOtp.updateMany({
    where: { id: record.id, consumedAt: null, attempts: { lt: OTP_MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  })
  if (claimed.count === 0) {
    await db.phoneOtp.updateMany({
      where: { id: record.id, consumedAt: null },
      data: { consumedAt: new Date() },
    })
    return { ok: false, reason: 'too_many_attempts' }
  }

  const matched = await verifyPassword(record.codeHash, code.trim())
  if (!matched) return { ok: false, reason: 'mismatch' }

  // 同樣用條件式更新：兩個帶著正確碼的並行請求只有一個能消耗成功
  const consumed = await db.phoneOtp.updateMany({
    where: { id: record.id, consumedAt: null },
    data: { consumedAt: new Date(), devCode: null },
  })
  if (consumed.count === 0) return { ok: false, reason: 'not_found' }
  return { ok: true, phone }
}
