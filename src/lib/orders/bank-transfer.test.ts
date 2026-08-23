import { describe, it, expect } from 'vitest'
import { formatTransferDeadline } from './bank-transfer'

describe('formatTransferDeadline', () => {
  it('固定用台北時間，不跟著伺服器時區跑', () => {
    // 2026-08-23 18:30 UTC = 2026-08-24 02:30 台北時間
    expect(formatTransferDeadline(new Date('2026-08-23T18:30:00Z'))).toBe('2026/08/24 02:30')
  })

  it('帶到分鐘 —— 那一刻就是訂單被自動取消的時間，只寫日期會讓客人誤判', () => {
    expect(formatTransferDeadline(new Date('2026-08-23T04:05:00Z'))).toBe('2026/08/23 12:05')
  })

  it('午夜是 00:xx 而不是 24:xx（zh-TW 的 hour12:false 會給 24 時制）', () => {
    // 2026-08-23 16:00 UTC = 2026-08-24 00:00 台北時間
    expect(formatTransferDeadline(new Date('2026-08-23T16:00:00Z'))).toBe('2026/08/24 00:00')
  })
})
