import { describe, expect, it } from 'vitest'
import { normalizeDescriptionHtml } from './description'

describe('normalizeDescriptionHtml', () => {
  it('沒有描述時回空字串', () => {
    expect(normalizeDescriptionHtml(null)).toBe('')
    expect(normalizeDescriptionHtml(undefined)).toBe('')
    expect(normalizeDescriptionHtml('')).toBe('')
  })

  describe('inline 樣式', () => {
    it('拔掉 style 屬性但保留段落與文字', () => {
      // 這是整件事的前提：留著 style，.prose-product 一條規則都不會生效
      const raw =
        '<p style="font-family: \'Helvetica Neue\'; color: #333333; background-color: #ffffff; margin: 0px;">文字</p>'
      expect(normalizeDescriptionHtml(raw)).toBe('<p>文字</p>')
    })

    it('span 標籤拆掉但內文留下', () => {
      // 來源站的 span 只是拿來塞 font-size: 12pt
      const raw = '<p><strong><span style="font-size: 12pt;">莎岡觀點</span></strong></p>'
      expect(normalizeDescriptionHtml(raw)).toBe('<p><strong>莎岡觀點</strong></p>')
    })

    it('div 這種版面標籤拆掉，內容往上提', () => {
      expect(normalizeDescriptionHtml('<div><p>巢狀</p></div>')).toBe('<p>巢狀</p>')
    })
  })

  describe('圖片', () => {
    it('拔掉 inline style 的寫死寬度，寬度交給 CSS', () => {
      const raw =
        '<img style="width: 642.107px; height: auto;" src="https://cdn.example/a.jpg" width="1000" height="1250" data-uploading="x" data-upload-status="success">'
      const out = normalizeDescriptionHtml(raw)
      expect(out).not.toMatch(/style=|data-/)
      expect(out).toContain('src="https://cdn.example/a.jpg"')
    })

    it('保留 width/height 屬性當作 aspect-ratio，避免載入時版面跳動', () => {
      // 拔掉的話圖片高度會從 0 長到 850px，除了 CLS 之外收摺高度也會量錯
      const out = normalizeDescriptionHtml(
        '<img src="https://cdn.example/a.jpg" width="1000" height="1250">',
      )
      expect(out).toContain('width="1000"')
      expect(out).toContain('height="1250"')
    })

    it.each([
      ['小數', '<img src="a.jpg" width="642.107" height="800">'],
      ['百分比', '<img src="a.jpg" width="100%" height="auto">'],
      ['只有一邊', '<img src="a.jpg" width="1000">'],
      ['零', '<img src="a.jpg" width="0" height="0">'],
    ])('%s 這種算不出比例的寬高整組丟掉', (_label, raw) => {
      const out = normalizeDescriptionHtml(raw)
      expect(out).not.toMatch(/width=|height=/)
    })

    it('沒有 alt 的圖補上空 alt 與 lazy 載入', () => {
      // 364 張圖裡 358 張沒有 alt；空 alt 讓輔助科技當裝飾圖跳過，
      // 而不是把 CDN 檔名整串念出來
      const out = normalizeDescriptionHtml('<img src="https://cdn.example/a.jpg">')
      expect(out).toContain('alt=""')
      expect(out).toContain('loading="lazy"')
    })

    it('原本有 alt 就不覆蓋', () => {
      const out = normalizeDescriptionHtml('<img src="https://cdn.example/a.jpg" alt="睡裙細節">')
      expect(out).toContain('alt="睡裙細節"')
    })
  })

  describe('空段落', () => {
    it('清掉來源站當間距用的空段落', () => {
      // 3715 個 <p> 裡有 1374 個是空的，留著段落節奏會被撐爛
      const raw = '<p>&nbsp;</p><p>真的內容</p><p>   </p><p><br></p><p>第二段</p>'
      expect(normalizeDescriptionHtml(raw)).toBe('<p>真的內容</p><p>第二段</p>')
    })

    it('只有空段落時整份回空字串', () => {
      expect(normalizeDescriptionHtml('<p>&nbsp;</p><p><br></p>')).toBe('')
    })
  })

  describe('安全性', () => {
    it('丟掉 script 標籤與其內容', () => {
      expect(normalizeDescriptionHtml('<script>alert(1)</script><p>安全</p>')).toBe('<p>安全</p>')
    })

    it('丟掉 style 標籤與其內容', () => {
      expect(normalizeDescriptionHtml('<style>p{color:red}</style><p>安全</p>')).toBe('<p>安全</p>')
    })

    it('丟掉事件處理屬性', () => {
      expect(normalizeDescriptionHtml('<img src="x" onerror="alert(1)">')).not.toMatch(/onerror/)
    })

    it('javascript: 連結的 href 被移除', () => {
      const out = normalizeDescriptionHtml('<a href="javascript:alert(1)">壞連結</a>')
      expect(out).not.toMatch(/javascript:/)
      expect(out).toContain('壞連結')
    })
  })

  describe('連結', () => {
    it('外部連結補上 target 與 rel', () => {
      const out = normalizeDescriptionHtml('<a href="https://example.com">連結</a>')
      expect(out).toContain('href="https://example.com"')
      expect(out).toContain('target="_blank"')
      expect(out).toContain('rel="noopener noreferrer nofollow"')
    })
  })

  describe('該保留的結構', () => {
    it('標題、清單、粗體、分隔線都留著', () => {
      const raw =
        '<h3 style="color:red">材質</h3><ul><li>棉 100%</li></ul><p><strong>重點</strong></p><hr style="border:0">'
      expect(normalizeDescriptionHtml(raw)).toBe(
        '<h3>材質</h3><ul><li>棉 100%</li></ul><p><strong>重點</strong></p><hr />',
      )
    })
  })
})
