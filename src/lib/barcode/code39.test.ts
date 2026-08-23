import { describe, it, expect } from 'vitest'
import { code39Svg, isEncodable, layoutCode39 } from './code39'

/**
 * 條碼畫錯了在畫面上看不出來 —— 只有超商店員刷不過才會知道，
 * 所以編碼表與元素寬度要用測試釘住。
 */
describe('layoutCode39', () => {
  it('每個字元 9 個元素、5 條黑條，字元之間多一個窄空白', () => {
    // 內容 1 個字元 + 前後兩個 * 起始結束符 = 3 個字元 → 15 條黑條
    const { bars } = layoutCode39('A', { narrowWidth: 1 })
    expect(bars).toHaveLength(15)
  })

  it('窄元素寬度可調，寬元素是窄的 2.5 倍', () => {
    const narrow = layoutCode39('0', { narrowWidth: 2 })
    const wide = layoutCode39('0', { narrowWidth: 4 })
    expect(wide.width).toBe(narrow.width * 2)

    // '0' 的樣式是 nnnwwnwnn：黑條依序為 n, n, w, w, n
    const widths = narrow.bars.slice(5, 10).map((bar) => bar.width)
    expect(widths).toEqual([2, 2, 5, 5, 2])
  })

  it('黑條不重疊，位置單調遞增', () => {
    const { bars } = layoutCode39('SAGON2026')
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i].x).toBeGreaterThanOrEqual(bars[i - 1].x + bars[i - 1].width)
    }
  })

  it('小寫字母會被轉成大寫（Code 39 沒有小寫）', () => {
    expect(layoutCode39('abc')).toEqual(layoutCode39('ABC'))
  })

  it('遇到編碼表沒有的字元直接丟錯，不要默默畫出刷不過的條碼', () => {
    expect(() => layoutCode39('繳費')).toThrow(/無法編碼/)
    // * 是起始／結束符號，不能出現在內容裡
    expect(isEncodable('LLL2623*')).toBe(false)
    expect(isEncodable('LLL26234929403')).toBe(true)
  })
})

describe('code39Svg', () => {
  it('產出合法 SVG，兩側留白至少 10 倍窄元素', () => {
    const svg = code39Svg('LLL26234929403', { narrowWidth: 2 })
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)

    const { width } = layoutCode39('LLL26234929403', { narrowWidth: 2 })
    const declared = Number(svg.match(/width="([\d.]+)"/)![1])
    expect(declared).toBeCloseTo(width + 40, 1)
  })

  it('號碼會一起寫在條碼下方，機器讀不到時人還看得懂', () => {
    expect(code39Svg('SG123')).toContain('>SG123<')
    expect(code39Svg('SG123', { showText: false })).not.toContain('>SG123<')
  })
})
