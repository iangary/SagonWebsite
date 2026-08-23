import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { createTestUser } from '../factories'

/**
 * Email 註冊驗證信的整合測試 —— 連真實 Postgres。
 *
 * 節流（冷卻、每小時上限）、「舊連結作廢」、「驗過就不再發」全部是 DB 狀態的行為，
 * 用假的 db 測等於在測 mock，所以放在整合測試。
 *
 * 時間一律靠改寫 DB 的 createdAt / expiresAt 來控制，不用假計時器 ——
 * 被測程式在多處各自呼叫 new Date()。
 */

interface SentMail {
  from: string
  to: string
  subject: string
  html: string
}

const { sendMailMock } = vi.hoisted(() => ({
  sendMailMock: vi.fn(async (options: SentMail) => {
    void options
    return { messageId: 'test-message-id' }
  }),
}))

/** 設成 Error 就讓下一次寄信失敗，用來測 SMTP 掛掉時的行為 */
const mailFailure = vi.hoisted(() => ({ current: null as Error | null }))

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: async (options: SentMail) => {
        if (mailFailure.current) throw mailFailure.current
        return sendMailMock(options)
      },
    })),
  },
}))

import {
  EMAIL_VERIFY_HOURLY_LIMIT,
  EMAIL_VERIFY_RESEND_COOLDOWN_SECONDS,
  consumeEmailVerification,
  requestEmailVerification,
} from '@/lib/auth/email-verification'

const EMAIL = 'buyer@test.local'

beforeEach(() => {
  sendMailMock.mockClear()
  mailFailure.current = null
})

/** 取最後一封寄出的信 */
function lastMail(): SentMail {
  const call = sendMailMock.mock.calls.at(-1)
  if (!call) throw new Error('沒有寄出任何信')
  return call[0]
}

/** 從信裡的連結取出 token —— 測試只看使用者看得到的東西 */
function tokenFromMail(): string {
  const match = /verify-email\?token=([A-Za-z0-9_-]+)/.exec(lastMail().html)
  if (!match) throw new Error('信裡找不到驗證連結')
  return match[1]
}

/** 把某個信箱所有驗證紀錄的 createdAt 往前推 N 秒（模擬時間流逝） */
async function ageRecords(email: string, seconds: number) {
  const rows = await db.emailVerification.findMany({
    where: { email },
    select: { id: true, createdAt: true },
  })
  for (const row of rows) {
    await db.emailVerification.update({
      where: { id: row.id },
      data: { createdAt: new Date(row.createdAt.getTime() - seconds * 1000) },
    })
  }
}

describe('requestEmailVerification — 寄出驗證信', () => {
  it('成功時建立一筆紀錄，信裡含驗證連結，且只存雜湊不存明碼 token', async () => {
    await createTestUser({ email: EMAIL })

    const result = await requestEmailVerification(EMAIL)
    expect(result).toEqual({ ok: true, cooldownSeconds: EMAIL_VERIFY_RESEND_COOLDOWN_SECONDS })

    const mail = lastMail()
    expect(mail.to).toBe(EMAIL)
    expect(mail.subject).toContain('驗證')

    const token = tokenFromMail()
    const rows = await db.emailVerification.findMany({ where: { email: EMAIL } })
    expect(rows).toHaveLength(1)
    expect(rows[0].tokenHash).not.toContain(token)
    expect(rows[0].consumedAt).toBeNull()
  })

  it('沒有這個會員 → no_account，不會寄信給不存在的信箱', async () => {
    const result = await requestEmailVerification('nobody@test.local')
    expect(result).toEqual({ ok: false, reason: 'no_account' })
    expect(sendMailMock).not.toHaveBeenCalled()
  })

  it('已經驗證過的信箱 → already_verified，不再寄第二封', async () => {
    await createTestUser({ email: EMAIL })
    await db.user.update({ where: { email: EMAIL }, data: { emailVerified: new Date() } })

    const result = await requestEmailVerification(EMAIL)
    expect(result).toEqual({ ok: false, reason: 'already_verified' })
    expect(sendMailMock).not.toHaveBeenCalled()
  })

  it('冷卻期內重複索取 → cooldown 並回 retryAfterSeconds', async () => {
    await createTestUser({ email: EMAIL })
    await requestEmailVerification(EMAIL)

    const second = await requestEmailVerification(EMAIL)
    if (second.ok) throw new Error('冷卻期內竟然又寄了一封')
    expect(second.reason).toBe('cooldown')
    expect(second.retryAfterSeconds).toBeGreaterThan(0)
    expect(sendMailMock).toHaveBeenCalledTimes(1)
  })

  it('超過冷卻期就可以再索取，而且舊連結立刻失效（同時只有一條有效）', async () => {
    await createTestUser({ email: EMAIL })
    await requestEmailVerification(EMAIL)
    const firstToken = tokenFromMail()

    await ageRecords(EMAIL, EMAIL_VERIFY_RESEND_COOLDOWN_SECONDS + 1)
    expect((await requestEmailVerification(EMAIL)).ok).toBe(true)
    const secondToken = tokenFromMail()
    expect(secondToken).not.toBe(firstToken)

    expect(await consumeEmailVerification(firstToken)).toEqual({ ok: false, reason: 'invalid' })
    expect(await consumeEmailVerification(secondToken)).toMatchObject({ ok: true })
  })

  it('一小時內超過上限 → rate_limited', async () => {
    await createTestUser({ email: EMAIL })

    for (let i = 0; i < EMAIL_VERIFY_HOURLY_LIMIT; i++) {
      expect((await requestEmailVerification(EMAIL)).ok).toBe(true)
      await ageRecords(EMAIL, EMAIL_VERIFY_RESEND_COOLDOWN_SECONDS + 1)
    }

    const blocked = await requestEmailVerification(EMAIL)
    expect(blocked).toEqual({ ok: false, reason: 'rate_limited', retryAfterSeconds: 3600 })
  })

  it('一小時前的舊紀錄不計入額度', async () => {
    await createTestUser({ email: EMAIL })

    for (let i = 0; i < EMAIL_VERIFY_HOURLY_LIMIT; i++) {
      await requestEmailVerification(EMAIL)
      await ageRecords(EMAIL, EMAIL_VERIFY_RESEND_COOLDOWN_SECONDS + 1)
    }
    await ageRecords(EMAIL, 3601)

    expect((await requestEmailVerification(EMAIL)).ok).toBe(true)
  })

  it('SMTP 掛掉 → mail_failed，而且不留紀錄（可以立刻再按重寄，不會被冷卻鎖住）', async () => {
    await createTestUser({ email: EMAIL })
    mailFailure.current = new Error('SMTP 連不上')

    expect(await requestEmailVerification(EMAIL)).toEqual({ ok: false, reason: 'mail_failed' })
    expect(await db.emailVerification.count({ where: { email: EMAIL } })).toBe(0)

    mailFailure.current = null
    expect((await requestEmailVerification(EMAIL)).ok).toBe(true)
  })

  it('信箱大小寫與前後空白不影響比對', async () => {
    await createTestUser({ email: EMAIL })
    expect((await requestEmailVerification(`  ${EMAIL.toUpperCase()} `)).ok).toBe(true)
    expect(lastMail().to).toBe(EMAIL)
  })
})

describe('consumeEmailVerification — 點連結', () => {
  beforeEach(async () => {
    await createTestUser({ email: EMAIL })
  })

  it('第一次點 → ok，User.emailVerified 蓋上時間戳，該筆被 consume', async () => {
    await requestEmailVerification(EMAIL)
    const token = tokenFromMail()

    const result = await consumeEmailVerification(token)
    expect(result).toEqual({ ok: true, email: EMAIL, alreadyVerified: false })

    const user = await db.user.findUniqueOrThrow({ where: { email: EMAIL } })
    expect(user.emailVerified).toBeInstanceOf(Date)

    const row = await db.emailVerification.findFirstOrThrow({ where: { email: EMAIL } })
    expect(row.consumedAt).toBeInstanceOf(Date)
  })

  it('同一條連結被點第二次 → 仍回 ok 但標記 alreadyVerified（信件掃描器預抓、使用者重整）', async () => {
    await requestEmailVerification(EMAIL)
    const token = tokenFromMail()

    await consumeEmailVerification(token)
    const second = await consumeEmailVerification(token)
    expect(second).toEqual({ ok: true, email: EMAIL, alreadyVerified: true })
  })

  it('過期 → expired，帳號沒被驗證，且該筆一併作廢不能再用', async () => {
    await requestEmailVerification(EMAIL)
    const token = tokenFromMail()
    await db.emailVerification.updateMany({
      where: { email: EMAIL },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

    expect(await consumeEmailVerification(token)).toEqual({ ok: false, reason: 'expired' })
    expect((await db.user.findUniqueOrThrow({ where: { email: EMAIL } })).emailVerified).toBeNull()
    expect(await consumeEmailVerification(token)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('亂猜的 token → invalid', async () => {
    expect(await consumeEmailVerification('not-a-real-token')).toEqual({
      ok: false,
      reason: 'invalid',
    })
    expect(await consumeEmailVerification('')).toEqual({ ok: false, reason: 'invalid' })
  })

  it('驗證過之後就不會再寄驗證信 —— 只有第一次會發', async () => {
    await requestEmailVerification(EMAIL)
    await consumeEmailVerification(tokenFromMail())
    sendMailMock.mockClear()

    await ageRecords(EMAIL, EMAIL_VERIFY_RESEND_COOLDOWN_SECONDS + 1)
    expect(await requestEmailVerification(EMAIL)).toEqual({
      ok: false,
      reason: 'already_verified',
    })
    expect(sendMailMock).not.toHaveBeenCalled()
  })
})
