import { describe, expect, it } from 'vitest'
import { normalizeGuestContact } from './contact'

describe('normalizeGuestContact', () => {
  it('接受 Email 並轉小寫', () => {
    expect(normalizeGuestContact('  Ian@Example.COM ')).toEqual({
      kind: 'EMAIL',
      value: 'ian@example.com',
    })
  })

  it('接受各種寫法的台灣手機，收斂成 09xxxxxxxx', () => {
    for (const raw of ['0912345678', '0912-345-678', '+886912345678', '886912345678']) {
      expect(normalizeGuestContact(raw)).toEqual({ kind: 'PHONE', value: '0912345678' })
    }
  })

  it('數字開頭的 Email 判成 Email 而不是電話', () => {
    // normalizeTwMobile 會把非數字抽掉，這個信箱剛好剩下一組合法手機號
    expect(normalizeGuestContact('0912345678@gmail.com')).toEqual({
      kind: 'EMAIL',
      value: '0912345678@gmail.com',
    })
  })

  it('格式不對回 null', () => {
    for (const raw of ['', '   ', 'LINE 上找我', 'ian@example', '0212345678', '091234567', null, 42]) {
      expect(normalizeGuestContact(raw)).toBeNull()
    }
  })
})
