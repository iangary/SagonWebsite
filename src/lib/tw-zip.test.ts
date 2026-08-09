import { describe, it, expect } from 'vitest'
import { zipToCity, isOutlyingIsland, tcatDistance } from './tw-zip'

describe('zipToCity', () => {
  it('對應到正確的縣市', () => {
    expect(zipToCity('104')).toBe('台北市')
    expect(zipToCity('220')).toBe('新北市')
    expect(zipToCity('300')).toBe('新竹市')
    expect(zipToCity('302')).toBe('新竹縣')
    expect(zipToCity('600')).toBe('嘉義市')
    expect(zipToCity('602')).toBe('嘉義縣')
    expect(zipToCity('807')).toBe('高雄市')
  })

  it('連江縣夾在新北市的號段中間，不能被誤判成新北市', () => {
    // 200-253 若當成一整段處理，209-212 這四碼就會錯，而且錯的正好是離島
    expect(zipToCity('208')).toBe('新北市')
    expect(zipToCity('209')).toBe('連江縣')
    expect(zipToCity('212')).toBe('連江縣')
    expect(zipToCity('220')).toBe('新北市')
  })

  it('吃得下六碼的 3+3 郵遞區號', () => {
    expect(zipToCity('104001')).toBe('台北市')
  })

  it('認不得的輸入回 null', () => {
    expect(zipToCity('')).toBeNull()
    expect(zipToCity('abc')).toBeNull()
    expect(zipToCity('999')).toBeNull()
    // 號段之間的空隙（新竹市 300 與新竹縣 302 之間）
    expect(zipToCity('301')).toBeNull()
  })
})

describe('isOutlyingIsland', () => {
  it('整縣是離島的三個縣', () => {
    expect(isOutlyingIsland('880')).toBe(true) // 澎湖馬公
    expect(isOutlyingIsland('885')).toBe(true) // 澎湖湖西
    expect(isOutlyingIsland('890')).toBe(true) // 金門金沙
    expect(isOutlyingIsland('896')).toBe(true) // 金門烏坵
    expect(isOutlyingIsland('209')).toBe(true) // 連江南竿
    expect(isOutlyingIsland('212')).toBe(true) // 連江東引
  })

  it('本島縣份底下的離島鄉', () => {
    expect(isOutlyingIsland('929')).toBe(true) // 屏東琉球
    expect(isOutlyingIsland('951')).toBe(true) // 台東綠島
    expect(isOutlyingIsland('952')).toBe(true) // 台東蘭嶼
  })

  it('同縣市裡的鄰居不會被誤判成離島', () => {
    expect(isOutlyingIsland('928')).toBe(false) // 屏東枋山
    expect(isOutlyingIsland('950')).toBe(false) // 台東市
    expect(isOutlyingIsland('953')).toBe(false) // 台東延平
    expect(isOutlyingIsland('208')).toBe(false) // 新北金山
  })
})

describe('tcatDistance', () => {
  const TAIPEI = '104' // 寄件地：台北市中山區

  it('同縣市回 00', () => {
    expect(tcatDistance(TAIPEI, '100')).toBe('00')
    expect(tcatDistance(TAIPEI, '116')).toBe('00')
  })

  it('外縣市回 01', () => {
    expect(tcatDistance(TAIPEI, '220')).toBe('01') // 新北板橋
    expect(tcatDistance(TAIPEI, '807')).toBe('01') // 高雄三民
    expect(tcatDistance(TAIPEI, '970')).toBe('01') // 花蓮市
  })

  it('離島回 02，優先於縣市比對', () => {
    expect(tcatDistance(TAIPEI, '880')).toBe('02')
    expect(tcatDistance(TAIPEI, '209')).toBe('02')
    expect(tcatDistance(TAIPEI, '929')).toBe('02')
    expect(tcatDistance(TAIPEI, '951')).toBe('02')
  })

  it('認不出郵遞區號時保守回 01，不會誤報成同縣市', () => {
    expect(tcatDistance(TAIPEI, '')).toBe('01')
    expect(tcatDistance(TAIPEI, '999')).toBe('01')
    expect(tcatDistance('', '104')).toBe('01')
  })
})
