import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { createTestUser } from '../factories'

/**
 * 「手機驗證碼只發第一次，之後用號碼＋密碼」的整合測試 —— 連真實 Postgres。
 *
 * 規則本身是看 DB 狀態（這支號碼有沒有帳號、有沒有密碼）決定要不要發簡訊，
 * 所以只能在真的資料庫上測。
 */

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

import { requestOtp, verifyOtp } from '@/lib/auth/otp'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { resetPasswordByOtp } from '@/app/[locale]/(auth)/forgot-password/actions'

const PHONE = '0912345678'

beforeEach(() => {
  smsOutbox.length = 0
})

/** 從最後一則簡訊取出 6 位數驗證碼 */
function codeFromSms(): string {
  const text = smsOutbox.at(-1)?.text
  if (!text) throw new Error('沒有寄出任何簡訊')
  const match = /(\d{6})/.exec(text)
  if (!match) throw new Error(`簡訊裡沒有驗證碼：${text}`)
  return match[1]
}

async function givenPhoneUser(overrides: { password?: string } = {}) {
  const user = await createTestUser({ phone: PHONE })
  if (overrides.password) {
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(overrides.password) },
    })
  }
  return user
}

describe('purpose=login：只有第一次會發驗證碼', () => {
  it('號碼還沒有帳號 → 發碼（發碼即註冊）', async () => {
    expect((await requestOtp(PHONE, 'login')).ok).toBe(true)
    expect(smsOutbox).toHaveLength(1)
  })

  it('有帳號但還沒設密碼 → 還是發碼（否則他連進站設密碼的門都沒有）', async () => {
    await givenPhoneUser()
    expect((await requestOtp(PHONE, 'login')).ok).toBe(true)
    expect(smsOutbox).toHaveLength(1)
  })

  it('已經設過密碼 → use_password，一則簡訊都不發', async () => {
    await givenPhoneUser({ password: 'secret12345' })

    expect(await requestOtp(PHONE, 'login')).toEqual({ ok: false, reason: 'use_password' })
    expect(smsOutbox).toHaveLength(0)
    expect(await db.phoneOtp.count({ where: { phone: PHONE } })).toBe(0)
  })

  it('綁定手機（purpose=bind）不受這條規則限制 —— 那是已登入會員在自己帳號頁上的操作', async () => {
    await givenPhoneUser({ password: 'secret12345' })
    expect((await requestOtp(PHONE, 'bind')).ok).toBe(true)
    expect(smsOutbox).toHaveLength(1)
  })
})

describe('purpose=reset：忘記密碼是已設密碼者唯一還會收到簡訊的路徑', () => {
  it('已設密碼的號碼 → 發碼', async () => {
    await givenPhoneUser({ password: 'secret12345' })
    expect((await requestOtp(PHONE, 'reset')).ok).toBe(true)
    expect(smsOutbox).toHaveLength(1)
  })

  it('號碼沒有帳號 → no_account，不浪費簡訊費', async () => {
    expect(await requestOtp(PHONE, 'reset')).toEqual({ ok: false, reason: 'no_account' })
    expect(smsOutbox).toHaveLength(0)
  })

  it('reset 的碼不能拿去當 login 用（purpose 互相隔離）', async () => {
    await givenPhoneUser({ password: 'secret12345' })
    await requestOtp(PHONE, 'reset')
    const code = codeFromSms()

    expect(await verifyOtp(PHONE, code, 'login')).toEqual({ ok: false, reason: 'not_found' })
    expect(await verifyOtp(PHONE, code, 'reset')).toEqual({ ok: true, phone: PHONE })
  })
})

describe('重設密碼之後', () => {
  it('新密碼可以驗證通過，舊密碼失效', async () => {
    const user = await givenPhoneUser({ password: 'oldpassword1' })

    await requestOtp(PHONE, 'reset')
    const verified = await verifyOtp(PHONE, codeFromSms(), 'reset')
    expect(verified.ok).toBe(true)

    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword('newpassword1') },
    })

    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(await verifyPassword(after.passwordHash!, 'newpassword1')).toBe(true)
    expect(await verifyPassword(after.passwordHash!, 'oldpassword1')).toBe(false)
  })

  it('設了密碼之後 login 就不再發碼了 —— 整條規則收在一起', async () => {
    await givenPhoneUser()
    expect((await requestOtp(PHONE, 'login')).ok).toBe(true)
    smsOutbox.length = 0

    await db.user.update({
      where: { phone: PHONE },
      data: { passwordHash: await hashPassword('secret12345') },
    })

    expect(await requestOtp(PHONE, 'login')).toEqual({ ok: false, reason: 'use_password' })
    expect(smsOutbox).toHaveLength(0)
  })
})

describe('resetPasswordByOtp — 忘記密碼的 server action', () => {
  /** action 收的是 FormData */
  function form(fields: Record<string, string>): FormData {
    const data = new FormData()
    for (const [k, v] of Object.entries(fields)) data.append(k, v)
    return data
  }

  it('正確的 reset 驗證碼 → 換上新密碼並回號碼（前端拿它直接登入）', async () => {
    await givenPhoneUser({ password: 'oldpassword1' })
    await requestOtp(PHONE, 'reset')

    const result = await resetPasswordByOtp(
      form({
        phone: PHONE,
        code: codeFromSms(),
        password: 'newpassword1',
        confirmPassword: 'newpassword1',
      }),
    )
    expect(result).toMatchObject({ ok: true, phone: PHONE })

    const user = await db.user.findUniqueOrThrow({ where: { phone: PHONE } })
    expect(await verifyPassword(user.passwordHash!, 'newpassword1')).toBe(true)
    expect(await verifyPassword(user.passwordHash!, 'oldpassword1')).toBe(false)
  })

  it('驗證碼錯誤 → 不改密碼', async () => {
    await givenPhoneUser({ password: 'oldpassword1' })
    await requestOtp(PHONE, 'reset')

    const result = await resetPasswordByOtp(
      form({ phone: PHONE, code: '000000', password: 'newpassword1', confirmPassword: 'newpassword1' }),
    )
    expect(result.ok).toBe(false)

    const user = await db.user.findUniqueOrThrow({ where: { phone: PHONE } })
    expect(await verifyPassword(user.passwordHash!, 'oldpassword1')).toBe(true)
  })

  it('同一組驗證碼不能重放', async () => {
    await givenPhoneUser({ password: 'oldpassword1' })
    await requestOtp(PHONE, 'reset')
    const code = codeFromSms()

    expect(
      (
        await resetPasswordByOtp(
          form({ phone: PHONE, code, password: 'newpassword1', confirmPassword: 'newpassword1' }),
        )
      ).ok,
    ).toBe(true)

    expect(
      (
        await resetPasswordByOtp(
          form({ phone: PHONE, code, password: 'hacker12345', confirmPassword: 'hacker12345' }),
        )
      ).ok,
    ).toBe(false)

    const user = await db.user.findUniqueOrThrow({ where: { phone: PHONE } })
    expect(await verifyPassword(user.passwordHash!, 'newpassword1')).toBe(true)
  })

  it('兩次密碼不一致 → 欄位錯誤，不動到帳號', async () => {
    await givenPhoneUser({ password: 'oldpassword1' })
    await requestOtp(PHONE, 'reset')

    const result = await resetPasswordByOtp(
      form({ phone: PHONE, code: codeFromSms(), password: 'newpassword1', confirmPassword: 'different1' }),
    )
    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.confirmPassword).toBeTruthy()
  })
})
