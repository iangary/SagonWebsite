import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import {
  OTP_HOURLY_LIMIT,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_MINUTES,
  requestOtp,
  verifyOtp,
} from '@/lib/auth/otp'

/**
 * 手機 OTP 的整合測試 —— 連真實 Postgres。
 *
 * 節流（冷卻、每小時上限）與「舊碼作廢」都是 DB 狀態的行為，
 * 用 mock 的 db 測等於在測 mock，所以放在整合測試。
 *
 * 時間一律靠改寫 DB 的 createdAt / expiresAt 來控制，不用假計時器：
 * 被測程式在多處各自呼叫 new Date()，假計時器只會讓測試更脆。
 */

// vi.mock 會被 hoist 到 import 之前，所以共用狀態要用 vi.hoisted 宣告
const smsOutbox = vi.hoisted(() => [] as Array<{ to: string; text: string; clientId?: string }>)
/** 設成 Error 就讓下一次發送失敗，用來測簡訊供應商掛掉時的行為 */
const smsFailure = vi.hoisted(() => ({ current: null as Error | null }))

// 只換掉 getSmsProvider；normalizeTwMobile 是純函式，要用真的那份
vi.mock('@/lib/sms/provider', async () => {
  const actual = await vi.importActual<typeof import('@/lib/sms/provider')>('@/lib/sms/provider')
  return {
    ...actual,
    getSmsProvider: vi.fn(() => ({
      name: 'test',
      async send(to: string, text: string, clientId?: string) {
        if (smsFailure.current) throw smsFailure.current
        smsOutbox.push({ to, text, clientId })
        // 對齊 ConsoleSmsProvider：devEcho 帶明碼內容，otp.ts 只看真假值
        return { messageId: null, devEcho: text }
      },
    })),
  }
})

const PHONE = '0912345678'

beforeEach(() => {
  smsOutbox.length = 0
  smsFailure.current = null
})

/** 把某支號碼所有 OTP 的 createdAt 往前推 N 秒（模擬時間流逝） */
async function ageRecords(phone: string, seconds: number) {
  const rows = await db.phoneOtp.findMany({ where: { phone }, select: { id: true, createdAt: true } })
  for (const row of rows) {
    await db.phoneOtp.update({
      where: { id: row.id },
      data: { createdAt: new Date(row.createdAt.getTime() - seconds * 1000) },
    })
  }
}

/** 直接塞歷史紀錄，用來鋪每小時額度的測試情境 */
async function seedOtp(phone: string, secondsAgo: number, purpose = 'login') {
  const createdAt = new Date(Date.now() - secondsAgo * 1000)
  return db.phoneOtp.create({
    data: {
      phone,
      purpose,
      codeHash: '$argon2id$fake',
      expiresAt: new Date(createdAt.getTime() + OTP_TTL_MINUTES * 60 * 1000),
      consumedAt: createdAt,
      createdAt,
    },
  })
}

describe('requestOtp — 索取驗證碼', () => {
  it('成功時建立一筆 PhoneOtp、回傳 cooldownSeconds，簡訊內含 6 位數驗證碼', async () => {
    const result = await requestOtp(PHONE)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.cooldownSeconds).toBe(OTP_RESEND_COOLDOWN_SECONDS)
    expect(result.devCode).toMatch(/^\d{6}$/)

    const rows = await db.phoneOtp.findMany({ where: { phone: PHONE } })
    expect(rows).toHaveLength(1)
    expect(rows[0].purpose).toBe('login')
    expect(rows[0].attempts).toBe(0)
    expect(rows[0].consumedAt).toBeNull()
    // console 類的 provider 會留明碼，方便本機開發與 E2E 取碼
    expect(rows[0].devCode).toBe(result.devCode)
    // 有效期約 OTP_TTL_MINUTES 分鐘（容忍測試執行的秒差）
    const ttlMs = rows[0].expiresAt.getTime() - rows[0].createdAt.getTime()
    expect(ttlMs).toBeGreaterThan((OTP_TTL_MINUTES * 60 - 30) * 1000)
    expect(ttlMs).toBeLessThan((OTP_TTL_MINUTES * 60 + 30) * 1000)

    expect(smsOutbox).toHaveLength(1)
    expect(smsOutbox[0].to).toBe(PHONE)
    expect(smsOutbox[0].text).toMatch(/\d{6}/)
    expect(smsOutbox[0].text).toContain(result.devCode)
  })

  it.each(['0912', '0212345678', 'abc', '', '09123456789'])(
    '非台灣手機格式 %s → invalid_phone，且不寫任何資料、不送簡訊',
    async (bad) => {
      const result = await requestOtp(bad)

      expect(result).toEqual({ ok: false, reason: 'invalid_phone' })
      expect(await db.phoneOtp.count()).toBe(0)
      expect(smsOutbox).toHaveLength(0)
    },
  )

  it('冷卻期內重複索取 → cooldown 並回 retryAfterSeconds', async () => {
    await requestOtp(PHONE)

    const second = await requestOtp(PHONE)

    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.reason).toBe('cooldown')
    expect(second.retryAfterSeconds).toBeGreaterThan(0)
    expect(second.retryAfterSeconds).toBeLessThanOrEqual(OTP_RESEND_COOLDOWN_SECONDS)
    // 被擋下來就不該再寫一筆、也不該再送簡訊
    expect(await db.phoneOtp.count({ where: { phone: PHONE } })).toBe(1)
    expect(smsOutbox).toHaveLength(1)
  })

  it('超過冷卻期就可以再索取', async () => {
    await requestOtp(PHONE)
    await ageRecords(PHONE, OTP_RESEND_COOLDOWN_SECONDS + 1)

    const second = await requestOtp(PHONE)

    expect(second.ok).toBe(true)
    expect(await db.phoneOtp.count({ where: { phone: PHONE } })).toBe(2)
    expect(smsOutbox).toHaveLength(2)
  })

  it(`一小時內第 ${OTP_HOURLY_LIMIT + 1} 次 → rate_limited`, async () => {
    // 5 筆都落在一小時內，且最近一筆已超過冷卻期（要測的是額度不是冷卻）
    for (const secondsAgo of [3000, 2400, 1800, 1200, 600]) {
      await seedOtp(PHONE, secondsAgo)
    }

    const result = await requestOtp(PHONE)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('rate_limited')
    expect(result.retryAfterSeconds).toBe(3600)
    expect(await db.phoneOtp.count({ where: { phone: PHONE } })).toBe(OTP_HOURLY_LIMIT)
    expect(smsOutbox).toHaveLength(0)
  })

  it('一小時前的舊紀錄不計入額度', async () => {
    for (let i = 0; i < OTP_HOURLY_LIMIT; i += 1) {
      await seedOtp(PHONE, 3600 + 60 * (i + 1))
    }

    const result = await requestOtp(PHONE)

    expect(result.ok).toBe(true)
    expect(await db.phoneOtp.count({ where: { phone: PHONE } })).toBe(OTP_HOURLY_LIMIT + 1)
  })

  it('索取新碼會把同號碼同 purpose 的舊碼全部作廢，不會有兩組碼同時有效', async () => {
    const first = await requestOtp(PHONE)
    expect(first.ok).toBe(true)
    await ageRecords(PHONE, OTP_RESEND_COOLDOWN_SECONDS + 1)

    const second = await requestOtp(PHONE)
    expect(second.ok).toBe(true)

    const alive = await db.phoneOtp.findMany({ where: { phone: PHONE, consumedAt: null } })
    expect(alive).toHaveLength(1)
    if (!first.ok || !second.ok) return
    expect(alive[0].devCode).toBe(second.devCode)

    // 舊碼已作廢 → 拿舊碼驗證只會撞到新那筆，一定不通過
    const replay = await verifyOtp(PHONE, first.devCode!)
    expect(replay).toEqual({ ok: false, reason: 'mismatch' })
  })

  it('每次索取都帶不同的 clientid（三竹的去重機制不能讓重送被吃掉）', async () => {
    await requestOtp(PHONE)
    await ageRecords(PHONE, OTP_RESEND_COOLDOWN_SECONDS + 1)
    await requestOtp(PHONE)

    expect(smsOutbox).toHaveLength(2)
    expect(smsOutbox[0].clientId).toBeTruthy()
    expect(smsOutbox[1].clientId).toBeTruthy()
    // 沿用同一個 clientid 會讓三竹回上次結果 + Duplicate=Y，使用者收不到第二則
    expect(smsOutbox[0].clientId).not.toBe(smsOutbox[1].clientId)
  })

  it('簡訊供應商掛掉 → sms_failed，不是往外拋 500', async () => {
    smsFailure.current = new Error('三竹簡訊發送失敗（statuscode=r）')

    const result = await requestOtp(PHONE)

    expect(result).toEqual({ ok: false, reason: 'sms_failed' })
  })

  it('簡訊發不出去時不寫 PhoneOtp，使用者可以立刻再試（不會被 cooldown 鎖住）', async () => {
    smsFailure.current = new Error('三竹簡訊 HTTP 502')
    expect((await requestOtp(PHONE)).ok).toBe(false)
    // 沒有紀錄 → 沒有 cooldown，也不會佔用每小時額度
    expect(await db.phoneOtp.count({ where: { phone: PHONE } })).toBe(0)

    smsFailure.current = null
    const retry = await requestOtp(PHONE)

    expect(retry.ok).toBe(true)
    expect(await db.phoneOtp.count({ where: { phone: PHONE } })).toBe(1)
  })

  it('DB 只存雜湊，codeHash 不是明碼', async () => {
    const result = await requestOtp(PHONE)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const row = await db.phoneOtp.findFirstOrThrow({ where: { phone: PHONE } })
    expect(row.codeHash).not.toBe(result.devCode)
    expect(row.codeHash).not.toContain(result.devCode)
    expect(row.codeHash.startsWith('$argon2id$')).toBe(true)
  })
})

describe('verifyOtp — 驗證驗證碼', () => {
  /** 索取一組可用的碼，回傳明碼 */
  async function issue(phone = PHONE, purpose: 'login' | 'bind' = 'login') {
    const result = await requestOtp(phone, purpose)
    if (!result.ok || !result.devCode) throw new Error('索取 OTP 失敗，測試前置條件不成立')
    return result.devCode
  }

  it('正確碼 → ok 並回正規化後的號碼，該筆被 consume、devCode 清空', async () => {
    const code = await issue()

    const result = await verifyOtp(PHONE, code)

    expect(result).toEqual({ ok: true, phone: PHONE })
    const row = await db.phoneOtp.findFirstOrThrow({ where: { phone: PHONE } })
    expect(row.consumedAt).not.toBeNull()
    expect(row.devCode).toBeNull() // 驗過就不留明碼
  })

  it('同一組碼不能重放：第二次驗證 → not_found', async () => {
    const code = await issue()
    expect((await verifyOtp(PHONE, code)).ok).toBe(true)

    const second = await verifyOtp(PHONE, code)

    expect(second).toEqual({ ok: false, reason: 'not_found' })
  })

  it('錯誤碼 → mismatch，attempts +1 且紀錄仍可再試', async () => {
    const code = await issue()

    const wrong = await verifyOtp(PHONE, code === '000000' ? '111111' : '000000')

    expect(wrong).toEqual({ ok: false, reason: 'mismatch' })
    const row = await db.phoneOtp.findFirstOrThrow({ where: { phone: PHONE } })
    expect(row.attempts).toBe(1)
    expect(row.consumedAt).toBeNull()

    // 還沒鎖死，正確碼仍然可以過
    expect(await verifyOtp(PHONE, code)).toEqual({ ok: true, phone: PHONE })
  })

  it(`連錯 ${OTP_MAX_ATTEMPTS} 次後再試 → too_many_attempts，且該筆被 consume`, async () => {
    const code = await issue()
    const wrong = code === '000000' ? '111111' : '000000'

    for (let i = 0; i < OTP_MAX_ATTEMPTS; i += 1) {
      expect(await verifyOtp(PHONE, wrong)).toEqual({ ok: false, reason: 'mismatch' })
    }
    expect((await db.phoneOtp.findFirstOrThrow({ where: { phone: PHONE } })).attempts).toBe(
      OTP_MAX_ATTEMPTS,
    )

    // 就算這次拿的是正確碼也不放行
    const blocked = await verifyOtp(PHONE, code)

    expect(blocked).toEqual({ ok: false, reason: 'too_many_attempts' })
    const row = await db.phoneOtp.findFirstOrThrow({ where: { phone: PHONE } })
    expect(row.consumedAt).not.toBeNull()
    // 已 consume → 之後連正確碼都只會得到 not_found
    expect(await verifyOtp(PHONE, code)).toEqual({ ok: false, reason: 'not_found' })
  })

  it('過期 → expired，且該筆一併被 consume 不能再試', async () => {
    const code = await issue()
    await db.phoneOtp.updateMany({
      where: { phone: PHONE },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

    const result = await verifyOtp(PHONE, code)

    expect(result).toEqual({ ok: false, reason: 'expired' })
    const row = await db.phoneOtp.findFirstOrThrow({ where: { phone: PHONE } })
    expect(row.consumedAt).not.toBeNull()
    expect(await verifyOtp(PHONE, code)).toEqual({ ok: false, reason: 'not_found' })
  })

  it('查無紀錄 → not_found', async () => {
    expect(await verifyOtp(PHONE, '123456')).toEqual({ ok: false, reason: 'not_found' })
  })

  it('號碼格式不合法 → invalid_phone', async () => {
    expect(await verifyOtp('0212345678', '123456')).toEqual({ ok: false, reason: 'invalid_phone' })
  })

  it('purpose 隔離：login 的碼不能拿來驗 bind', async () => {
    const code = await issue(PHONE, 'login')

    expect(await verifyOtp(PHONE, code, 'bind')).toEqual({ ok: false, reason: 'not_found' })
    // 原本的 login 碼不受影響，仍然可用
    expect(await verifyOtp(PHONE, code, 'login')).toEqual({ ok: true, phone: PHONE })
  })

  it("號碼正規化：'0912-345-678' 與 '0912345678' 視為同一支", async () => {
    const result = await requestOtp('0912-345-678')
    expect(result.ok).toBe(true)
    if (!result.ok || !result.devCode) return

    // 寫進 DB 的是正規化後的號碼
    const row = await db.phoneOtp.findFirstOrThrow({})
    expect(row.phone).toBe(PHONE)
    expect(smsOutbox[0].to).toBe(PHONE)

    // 用另一種寫法（含國碼）也驗得過，回傳一律是正規化的形式
    expect(await verifyOtp('+886912345678', result.devCode)).toEqual({ ok: true, phone: PHONE })
  })
})
