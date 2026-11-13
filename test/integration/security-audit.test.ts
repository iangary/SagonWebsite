import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', async () => (await import('./mocks')).authMockModule())
vi.mock('next/headers', async () => (await import('./mocks')).nextHeadersMockModule())
vi.mock('next/cache', async () => (await import('./mocks')).nextCacheMockModule())
vi.mock('next-intl/server', async () => (await import('./mocks')).nextIntlServerMockModule())

const smsOutbox = vi.hoisted(() => [] as Array<{ to: string; text: string }>)

vi.mock('@/lib/sms/provider', async () => {
  const actual = await vi.importActual<typeof import('@/lib/sms/provider')>('@/lib/sms/provider')
  return {
    ...actual,
    getSmsProvider: vi.fn(() => ({
      name: 'test',
      async send(to: string, text: string) {
        smsOutbox.push({ to, text })
        return { messageId: null, devEcho: text }
      },
    })),
  }
})

import { db } from '@/lib/db'
import { OTP_MAX_ATTEMPTS, requestOtp, verifyOtp } from '@/lib/auth/otp'
import { hashPassword } from '@/lib/auth/password'
import { registerAction } from '@/app/[locale]/(auth)/register/actions'
import { resetPasswordByOtp } from '@/app/[locale]/(auth)/forgot-password/actions'
import { setPassword } from '@/app/[locale]/account/actions'
import { POST as otpRequestPost } from '@/app/api/auth/otp/request/route'
import { createTestUser } from '../factories'
import { keepCurrentSessionMock, mockAuthUser } from './mocks'

/**
 * 2026-10 資安稽核修掉的幾個洞，各留一條會紅的測試釘住。
 * 連真實 Postgres —— 這幾個都是「資料庫狀態對不對」的問題，mock 掉 db 就測不到。
 */

const PHONE = '0912345678'

beforeEach(() => {
  smsOutbox.length = 0
  keepCurrentSessionMock.mockClear()
  mockAuthUser(null)
})

function codeFromSms(): string {
  const match = /(\d{6})/.exec(smsOutbox.at(-1)?.text ?? '')
  if (!match) throw new Error('沒有寄出驗證碼簡訊')
  return match[1]
}

function registerForm(email: string): FormData {
  const form = new FormData()
  form.set('name', '攻擊者')
  form.set('email', email)
  form.set('password', 'attacker-pass-123')
  form.set('confirmPassword', 'attacker-pass-123')
  return form
}

describe('註冊頁不能替只用 SSO 的帳號設密碼', () => {
  it('Email 已存在但沒有密碼 → 擋下，而且不寫入任何密碼', async () => {
    const victim = await createTestUser({ email: 'victim@test.local' })
    expect(victim.passwordHash).toBeNull()

    const result = await registerAction({ ok: false }, registerForm('victim@test.local'))

    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.email).toBe('emailTakenSso')
    const after = await db.user.findUniqueOrThrow({ where: { id: victim.id } })
    expect(after.passwordHash).toBeNull()
  })
})

describe('OTP 嘗試上限擋得住並行猜碼', () => {
  it(`同時送出一堆錯誤的碼，attempts 不會超過 ${OTP_MAX_ATTEMPTS}，之後連正確的碼也失效`, async () => {
    await createTestUser({ phone: PHONE })
    expect((await requestOtp(PHONE, 'reset')).ok).toBe(true)
    const code = codeFromSms()
    const wrong = code === '000000' ? '111111' : '000000'

    const results = await Promise.all(
      Array.from({ length: OTP_MAX_ATTEMPTS * 3 }, () => verifyOtp(PHONE, wrong, 'reset')),
    )
    expect(results.every((r) => !r.ok)).toBe(true)

    const record = await db.phoneOtp.findFirstOrThrow({ where: { phone: PHONE, purpose: 'reset' } })
    expect(record.attempts).toBeLessThanOrEqual(OTP_MAX_ATTEMPTS)

    expect((await verifyOtp(PHONE, code, 'reset')).ok).toBe(false)
  })

  it('正確的碼並行送兩次，只有一次成功', async () => {
    await createTestUser({ phone: PHONE })
    await requestOtp(PHONE, 'reset')
    const code = codeFromSms()

    const results = await Promise.all([
      verifyOtp(PHONE, code, 'reset'),
      verifyOtp(PHONE, code, 'reset'),
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
  })
})

describe('綁定號碼的驗證碼要登入才發', () => {
  it('未登入用 purpose=bind 索取 → 401，沒有發出任何簡訊', async () => {
    const res = await otpRequestPost(
      new Request('http://localhost:3000/api/auth/otp/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: PHONE, purpose: 'bind' }),
      }) as never,
    )
    expect(res.status).toBe(401)
    expect(smsOutbox).toHaveLength(0)
  })
})

describe('改密碼讓既有 session 失效', () => {
  it('忘記密碼重設 → sessionVersion +1', async () => {
    const user = await createTestUser({ phone: PHONE })
    await requestOtp(PHONE, 'reset')

    const form = new FormData()
    form.set('phone', PHONE)
    form.set('code', codeFromSms())
    form.set('password', 'brand-new-pass-1')
    form.set('confirmPassword', 'brand-new-pass-1')
    expect((await resetPasswordByOtp(form)).ok).toBe(true)

    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(after.sessionVersion).toBe(user.sessionVersion + 1)
  })

  it('帳號安全頁變更密碼 → sessionVersion +1，並留住目前這個 session', async () => {
    const user = await createTestUser()
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword('old-password-1') },
    })
    mockAuthUser({ id: user.id, role: 'CUSTOMER' })

    const form = new FormData()
    form.set('currentPassword', 'old-password-1')
    form.set('newPassword', 'new-password-2')
    form.set('confirmPassword', 'new-password-2')
    const result = await setPassword({ ok: false }, form)
    expect(result.ok).toBe(true)

    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(after.sessionVersion).toBe(1)
    expect(keepCurrentSessionMock).toHaveBeenCalledWith(user.id, 1)
  })

  it('SSO 會員第一次設定密碼 → 不動 sessionVersion（沒有舊密碼可以外洩）', async () => {
    const user = await createTestUser()
    mockAuthUser({ id: user.id, role: 'CUSTOMER' })

    const form = new FormData()
    form.set('currentPassword', '')
    form.set('newPassword', 'first-password-1')
    form.set('confirmPassword', 'first-password-1')
    expect((await setPassword({ ok: false }, form)).ok).toBe(true)

    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(after.sessionVersion).toBe(0)
    expect(keepCurrentSessionMock).not.toHaveBeenCalled()
  })
})
