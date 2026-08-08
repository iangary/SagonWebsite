import { describe, it, expect } from 'vitest'
import { mapLogisticsStatus, sanitizeGoodsName, isC2C } from './logistics'

describe('mapLogisticsStatus', () => {
  it('300「綠界已收到訂單資料」是建單完成，不是已出貨', () => {
    // 這個碼曾經被錯誤歸到 IN_TRANSIT，導致訂單一建立就被標成已出貨並寄出貨通知
    expect(mapLogisticsStatus('300')).toBe('CREATED')
    expect(mapLogisticsStatus('310')).toBe('CREATED')
  })

  it('出貨與運送中的碼對應到 IN_TRANSIT', () => {
    expect(mapLogisticsStatus('2030')).toBe('IN_TRANSIT')
    expect(mapLogisticsStatus('3006')).toBe('IN_TRANSIT')
  })

  it('到店可取貨對應到 ARRIVED', () => {
    expect(mapLogisticsStatus('2063')).toBe('ARRIVED')
    expect(mapLogisticsStatus('2073')).toBe('ARRIVED')
  })

  it('已取貨對應到 PICKED_UP', () => {
    expect(mapLogisticsStatus('2067')).toBe('PICKED_UP')
    expect(mapLogisticsStatus('3022')).toBe('PICKED_UP')
  })

  it('退貨系列的前綴碼對應到 RETURNED', () => {
    expect(mapLogisticsStatus('2041')).toBe('RETURNED')
    expect(mapLogisticsStatus('3045')).toBe('RETURNED')
    expect(mapLogisticsStatus('2065')).toBe('RETURNED')
  })

  it('認不得的碼回 null，讓呼叫端不要亂改狀態', () => {
    expect(mapLogisticsStatus('9999')).toBeNull()
    expect(mapLogisticsStatus('')).toBeNull()
  })

  it('同一個碼不會同時落在兩個狀態', () => {
    const seen = new Map<string, string>()
    const codes = [
      ['CREATED', ['300', '310', '2001', '3001']],
      ['IN_TRANSIT', ['2030', '2024', '3006', '3024']],
      ['ARRIVED', ['2063', '2073', '3018', '2068']],
      ['PICKED_UP', ['2067', '2070', '3022', '3023']],
      ['RETURNED', ['2065', '2074', '3019', '2069', '3020']],
      ['FAILED', ['2072', '3021']],
    ] as const

    for (const [status, list] of codes) {
      for (const code of list) {
        expect(seen.has(code), `代碼 ${code} 同時出現在 ${seen.get(code)} 與 ${status}`).toBe(false)
        seen.set(code, status)
        expect(mapLogisticsStatus(code)).toBe(status)
      }
    }
  })
})

describe('sanitizeGoodsName', () => {
  it('移除綠界不接受的符號', () => {
    expect(sanitizeGoodsName('ABC^\'`!@#%&*+\\"<>|_[]DEF', 50)).toBe('ABC DEF')
  })

  it('依通路截斷長度（C2C 25 字、B2C 50 字）', () => {
    const long = 'あ'.repeat(80)
    expect(sanitizeGoodsName(long, 25)).toHaveLength(25)
    expect(sanitizeGoodsName(long, 50)).toHaveLength(50)
  })

  it('清空後為空字串時回預設值，避免送出空的商品名稱', () => {
    expect(sanitizeGoodsName('###', 50)).toBe('商品')
  })
})

describe('isC2C', () => {
  it('超商取貨是 C2C，宅配不是', () => {
    expect(isC2C('UNIMARTC2C')).toBe(true)
    expect(isC2C('FAMIC2C')).toBe(true)
    expect(isC2C('TCAT')).toBe(false)
    expect(isC2C('POST')).toBe(false)
  })
})
