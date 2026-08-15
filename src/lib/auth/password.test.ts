import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './password'

/**
 * 密碼雜湊的單元測試（不碰資料庫）。
 *
 * argon2id 的參數是 OWASP 建議值，每次雜湊約數十毫秒，
 * 所以這裡只跑必要的組合，不做大量迴圈。
 */

describe('hashPassword', () => {
  it('產出 argon2id 格式字串，且不含原始密碼', async () => {
    const digest = await hashPassword('correct horse battery staple')

    expect(digest.startsWith('$argon2id$')).toBe(true)
    expect(digest).not.toContain('correct horse battery staple')
    // $argon2id$v=..$m=..,t=..,p=..$salt$hash
    expect(digest.split('$')).toHaveLength(6)
  })

  it('同一組密碼兩次雜湊結果不同（每次都有隨機 salt）', async () => {
    const [a, b] = await Promise.all([hashPassword('same-password'), hashPassword('same-password')])

    expect(a).not.toBe(b)
    // 但兩份都驗得過
    expect(await verifyPassword(a, 'same-password')).toBe(true)
    expect(await verifyPassword(b, 'same-password')).toBe(true)
  })
})

describe('verifyPassword', () => {
  it('正確密碼回 true、錯誤密碼回 false', async () => {
    const digest = await hashPassword('s3cret-pw')

    expect(await verifyPassword(digest, 's3cret-pw')).toBe(true)
    expect(await verifyPassword(digest, 's3cret-pW')).toBe(false)
    expect(await verifyPassword(digest, 's3cret-pw ')).toBe(false)
    expect(await verifyPassword(digest, '')).toBe(false)
  })

  it('空字串與極長密碼都能正確雜湊與驗證', async () => {
    const emptyDigest = await hashPassword('')
    expect(emptyDigest.startsWith('$argon2id$')).toBe(true)
    expect(await verifyPassword(emptyDigest, '')).toBe(true)
    expect(await verifyPassword(emptyDigest, 'x')).toBe(false)

    const long = 'a'.repeat(1000)
    const longDigest = await hashPassword(long)
    expect(await verifyPassword(longDigest, long)).toBe(true)
    // 只差最後一個字元也要驗不過
    expect(await verifyPassword(longDigest, `${long}b`)).toBe(false)
    expect(await verifyPassword(longDigest, 'a'.repeat(999))).toBe(false)
  })

  it('CJK 與特殊字元密碼可正確驗證', async () => {
    const pw = '莎岡選品店-密碼🔐 <>&"\'\\ $#@!'
    const digest = await hashPassword(pw)

    expect(await verifyPassword(digest, pw)).toBe(true)
    expect(await verifyPassword(digest, '莎岡選品店-密碼🔐 <>&"\'\\ $#@')).toBe(false)
    // 全形／半形不可混用
    expect(await verifyPassword(digest, '莎岡選品店-密碼🔐 <>&"\'\\ ＄#@!')).toBe(false)
  })

  it('雜湊格式壞掉時回 false 而不是拋錯', async () => {
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false)
    expect(await verifyPassword('', 'anything')).toBe(false)
    expect(await verifyPassword('$argon2id$broken', 'anything')).toBe(false)
  })
})
