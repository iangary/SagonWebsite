import { describe, expect, it } from 'vitest'
import { extractProductSlugs, plainTextExcerpt, sanitizePostHtml } from './html'
import { parseTaipeiDateTime, parseTags, toTaipeiDateTimeInput } from './form'

describe('sanitizePostHtml — XSS', () => {
  it.each([
    ['<script>alert(1)</script><p>ok</p>', '<p>ok</p>'],
    ['<p onclick="alert(1)">ok</p>', '<p>ok</p>'],
    ['<img src="/uploads/a.webp" onerror="alert(1)">', '<img src="/uploads/a.webp" alt="" loading="lazy" />'],
    ['<a href="javascript:alert(1)">x</a>', '<a>x</a>'],
    ['<a href="JaVaScRiPt:alert(1)">x</a>', '<a>x</a>'],
    ['<iframe src="https://evil.example"></iframe><p>ok</p>', '<p>ok</p>'],
    ['<style>body{display:none}</style><p>ok</p>', '<p>ok</p>'],
    ['<form action="/x"><input name="a"></form><p>ok</p>', '<p>ok</p>'],
    ['<svg><script>alert(1)</script></svg><p>ok</p>', '<p>ok</p>'],
  ])('%s', (input, expected) => {
    expect(sanitizePostHtml(input)).toBe(expected)
  })

  it('data:、javascript:、相對路徑與 // 開頭的圖片整張移除', () => {
    for (const src of ['data:image/svg+xml;base64,AAAA', 'javascript:alert(1)', 'x', 'images/a.jpg', '//evil.example/a.png']) {
      expect(sanitizePostHtml(`<p>a<img src="${src}">b</p>`)).toBe('<p>ab</p>')
    }
    expect(sanitizePostHtml('<img src="https://cdn.example/a.jpg">')).toContain('src="https://cdn.example/a.jpg"')
  })

  it('inline style 只留允許清單內的屬性與值', () => {
    const out = sanitizePostHtml(
      '<p style="text-align:center;color:#c00;position:fixed;background-image:url(javascript:alert(1))">x</p>',
    )
    expect(out).toContain('text-align:center')
    expect(out).toContain('color:#c00')
    expect(out).not.toContain('position')
    expect(out).not.toContain('url(')
  })

  it('實體編碼的標籤仍然是文字', () => {
    expect(sanitizePostHtml('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    )
  })
})

describe('sanitizePostHtml — 版面', () => {
  it('整份 HTML 文件只取 <body>，<title> 的字不會跑進內文', () => {
    const doc =
      '<!doctype html><html><head><title>草稿標題</title><style>p{color:red}</style></head>' +
      '<body><h1>大標</h1><p>內文</p></body></html>'
    expect(sanitizePostHtml(doc)).toBe('<h2>大標</h2><p>內文</p>')
  })

  it('站外連結另開分頁並加 rel；站內連結不動', () => {
    expect(sanitizePostHtml('<a href="https://example.com">x</a>')).toBe(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">x</a>',
    )
    expect(sanitizePostHtml('<a href="/product/a" target="_blank">x</a>')).toBe('<a href="/product/a">x</a>')
  })

  it('保留表格、圖說與圖片尺寸', () => {
    const out = sanitizePostHtml(
      '<figure><img src="/uploads/posts/a/b.webp" width="800" height="600"><figcaption>說明</figcaption></figure>' +
        '<table><tr><td colspan="2">x</td></tr></table>',
    )
    expect(out).toContain('width="800" height="600"')
    expect(out).toContain('<figcaption>說明</figcaption>')
    expect(out).toContain('<td colspan="2">x</td>')
  })

  it('空段落拿掉', () => {
    expect(sanitizePostHtml('<p>a</p><p>&nbsp;</p><p><br></p><p>b</p>')).toBe('<p>a</p><p>b</p>')
  })
})

describe('商品短碼', () => {
  it('extractProductSlugs 去重並保留順序', () => {
    expect(extractProductSlugs('<p>{{product:a}}</p>{{ product : b }}<p>{{product:a}}</p>')).toEqual(['a', 'b'])
  })

  it('有 renderer 時換成卡片，renderer 回 null 就整段消失', () => {
    const out = sanitizePostHtml('<p>{{product:ok}}</p><p>{{product:gone}}</p>', (slug) =>
      slug === 'ok' ? '<a class="journal-product" href="/product/ok">卡片</a>' : null,
    )
    expect(out).toBe('<p><a class="journal-product" href="/product/ok">卡片</a></p>')
  })

  it('沒有 renderer 時短碼保留成文字', () => {
    expect(sanitizePostHtml('<p>{{product:x}}</p>')).toBe('<p>{{product:x}}</p>')
  })

  it('短碼在連結文字或屬性裡不展開', () => {
    const render = () => '<b>CARD</b>'
    expect(sanitizePostHtml('<a href="/x">{{product:a}}</a>', render)).toBe('<a href="/x">{{product:a}}</a>')
    expect(sanitizePostHtml('<img src="/a.webp" alt="{{product:a}}">', render)).not.toContain('CARD')
  })
})

describe('plainTextExcerpt', () => {
  it('去標籤、去短碼、截斷', () => {
    expect(plainTextExcerpt('<h2>標題</h2><p>第一段 &amp; 內容</p><p>{{product:a}}</p>', 100)).toBe(
      '標題第一段 & 內容',
    )
    expect(plainTextExcerpt('<p>一二三四五六</p>', 4)).toBe('一二三…')
  })
})

describe('表單工具', () => {
  it('parseTags：各種分隔符號、去 #、去重、上限 10 個', () => {
    expect(parseTags('穿搭, 新品、#睡衣，穿搭\n保養')).toEqual(['穿搭', '新品', '睡衣', '保養'])
    expect(parseTags(Array.from({ length: 15 }, (_, i) => `t${i}`).join(','))).toHaveLength(10)
    expect(parseTags('  ,  ')).toEqual([])
  })

  it('datetime-local 一律當台北時間', () => {
    expect(parseTaipeiDateTime('2026-11-13T20:00')?.toISOString()).toBe('2026-11-13T12:00:00.000Z')
    expect(parseTaipeiDateTime('not a date')).toBeNull()
    expect(toTaipeiDateTimeInput(new Date('2026-11-13T12:00:00Z'))).toBe('2026-11-13T20:00')
    expect(toTaipeiDateTimeInput(null)).toBe('')
  })
})
