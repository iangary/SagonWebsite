import { describe, expect, it } from 'vitest'
import { normalizeTwMobile, parseTaipeiDateTime, toLegacyMember } from './import-members'

describe('舊網站會員資料', () => {
  it('一列轉成會員：Email 轉小寫、手機正規化、加入日期當台北時間', () => {
    expect(
      toLegacyMember({
        會員編號: 'MB1234567890123',
        姓名: ' 王小明 ',
        Email: 'Ming@Example.COM',
        電話: '0912-345-678',
        手機驗證: '已驗證',
        加入日期: '2024-03-05 14:22:10',
      }),
    ).toEqual({
      legacyId: 'MB1234567890123',
      name: '王小明',
      email: 'ming@example.com',
      phone: '0912345678',
      phoneVerified: true,
      joinedAt: '2024-03-05T06:22:10.000Z',
    })
  })

  it('空白與格式不對的欄位變成 null', () => {
    const m = toLegacyMember({ 會員編號: 'X', 姓名: '', Email: 'not-an-email', 電話: '12345', 手機驗證: '未驗證' })
    expect(m).toMatchObject({ name: null, email: null, phone: null, phoneVerified: false, joinedAt: null })
  })

  it('手機：+886 與 886 開頭換成 09', () => {
    expect(normalizeTwMobile('+886912345678')).toBe('0912345678')
    expect(normalizeTwMobile('886 912 345 678')).toBe('0912345678')
    expect(normalizeTwMobile('0212345678')).toBeNull()
  })

  it('只有日期也接受', () => {
    expect(parseTaipeiDateTime('2023-12-31')).toBe('2023-12-30T16:00:00.000Z')
    expect(parseTaipeiDateTime('昨天')).toBeNull()
  })
})
