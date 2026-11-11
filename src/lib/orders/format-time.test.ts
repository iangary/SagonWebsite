import { describe, expect, it } from 'vitest'
import { formatOrderTime } from './format-time'

// 台北 2026-11-12 10:00
const NOW = new Date('2026-11-12T02:00:00Z')

describe('formatOrderTime', () => {
  it('今天、昨天只寫時刻', () => {
    expect(formatOrderTime(new Date('2026-11-12T01:05:00Z'), NOW)).toBe('今天 09:05')
    expect(formatOrderTime(new Date('2026-11-11T14:30:00Z'), NOW)).toBe('昨天 22:30')
  })

  it('以台北時間判斷日期：UTC 還是前一天，台北已經是今天', () => {
    // UTC 11/11 16:30 = 台北 11/12 00:30
    expect(formatOrderTime(new Date('2026-11-11T16:30:00Z'), NOW)).toBe('今天 00:30')
  })

  it('今年寫月/日，往年寫年份', () => {
    expect(formatOrderTime(new Date('2026-08-23T05:33:55Z'), NOW)).toBe('8/23 13:33')
    expect(formatOrderTime(new Date('2025-12-31T08:00:00Z'), NOW)).toBe('2025/12/31')
  })
})
