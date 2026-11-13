import { describe, expect, it } from 'vitest'
import { collectImageSrcs, parseImportDate, parsePostHtml, PostImportError, rewriteImageSrcs } from './import'

const FULL = `<!doctype html>
<html lang="zh-TW">
<head>
  <meta charset="utf-8">
  <title>秋冬睡衣穿搭指南</title>
  <meta name="description" content="三個重點挑對秋冬睡衣。">
  <meta name="keywords" content="穿搭, 秋冬、睡衣">
  <meta name="slug" content="Autumn Pajamas">
  <meta name="status" content="published">
  <meta name="date" content="2026-11-20 20:00">
  <meta name="seo-title" content="秋冬睡衣怎麼挑｜莎岡">
  <style>p { color: red }</style>
</head>
<body>
  <h1>秋冬睡衣穿搭指南</h1>
  <p><img src="data:image/png;base64,AAAA" alt="題圖"></p>
  <p>天氣轉涼了。</p>
  <div data-product="lena-pink"></div>
  <script>alert(1)</script>
  <article lang="en" data-excerpt="Three tips.">
    <h1>Autumn Pajama Guide</h1>
    <p>It is getting cold.</p>
    <div data-product="lena-pink"></div>
  </article>
  <article lang="de"><h1>Herbst</h1><p>x</p></article>
</body>
</html>`

describe('parsePostHtml', () => {
  it('從一個檔案讀出所有欄位', () => {
    const p = parsePostHtml(FULL)
    expect(p).toMatchObject({
      title: '秋冬睡衣穿搭指南',
      slug: 'autumn-pajamas',
      excerpt: '三個重點挑對秋冬睡衣。',
      tags: ['穿搭', '秋冬', '睡衣'],
      status: 'PUBLISHED',
      seoTitle: '秋冬睡衣怎麼挑｜莎岡',
      coverImageSrc: 'data:image/png;base64,AAAA',
    })
    expect(p.publishedAt?.toISOString()).toBe('2026-11-20T12:00:00.000Z')
  })

  it('內文：拿掉標題 h1、題圖（已當封面）、script/style；data-product 換成短碼', () => {
    const { bodyHtml } = parsePostHtml(FULL)
    expect(bodyHtml).not.toContain('<h1')
    expect(bodyHtml).not.toContain('data:image')
    expect(bodyHtml).not.toContain('script')
    expect(bodyHtml).not.toContain('color: red')
    expect(bodyHtml).not.toContain('Autumn')
    expect(bodyHtml).toContain('<p>天氣轉涼了。</p>')
    expect(bodyHtml).toContain('<p>{{product:lena-pink}}</p>')
  })

  it('譯文：<article lang> 的第一個 h1 是標題，不支援的語系提醒並略過', () => {
    const p = parsePostHtml(FULL)
    expect(p.translations).toEqual([
      {
        locale: 'en',
        title: 'Autumn Pajama Guide',
        excerpt: 'Three tips.',
        bodyHtml: expect.stringContaining('<p>It is getting cold.</p>'),
      },
    ])
    expect(p.translations[0]!.bodyHtml).toContain('{{product:lena-pink}}')
    expect(p.warnings.join()).toContain('de')
  })

  it('最小檔案：只有片段也行，標題取第一個 h1，沒寫的欄位是 undefined', () => {
    const p = parsePostHtml('<h1>只有標題</h1><p>內文</p>')
    expect(p.title).toBe('只有標題')
    expect(p.bodyHtml).toBe('<p>內文</p>')
    expect(p.slug).toBeUndefined()
    expect(p.status).toBeUndefined()
    expect(p.tags).toBeUndefined()
    expect(p.coverImageSrc).toBeUndefined()
  })

  it('<title> 在沒有 <body> 的片段裡也讀得到，且不會跑進內文', () => {
    const p = parsePostHtml('<title>標題 A</title><p>內文</p>')
    expect(p.title).toBe('標題 A')
    expect(p.bodyHtml).toBe('<p>內文</p>')
  })

  it('og:image 指定封面時，內文第一張圖保留', () => {
    const p = parsePostHtml(
      '<head><title>T</title><meta property="og:image" content="https://cdn.example/c.jpg"></head>' +
        '<body><p><img src="https://cdn.example/a.jpg"></p><p>x</p></body>',
    )
    expect(p.coverImageSrc).toBe('https://cdn.example/c.jpg')
    expect(p.bodyHtml).toContain('a.jpg')
  })

  it('內文中間的圖片不會被拿去當封面時刪掉', () => {
    const p = parsePostHtml('<title>T</title><p>先有文字</p><p><img src="https://x.example/a.jpg"></p>')
    expect(p.coverImageSrc).toBe('https://x.example/a.jpg')
    expect(p.bodyHtml).toContain('a.jpg')
  })

  it('沒有標題或沒有內文 → 錯誤', () => {
    expect(() => parsePostHtml('<p>沒有標題</p>')).toThrow(PostImportError)
    expect(() => parsePostHtml('<title>只有標題</title>')).toThrow(PostImportError)
  })

  it('status 看不懂 → 提醒、不改狀態', () => {
    const p = parsePostHtml('<title>T</title><meta name="status" content="maybe"><p>x</p>')
    expect(p.status).toBeUndefined()
    expect(p.warnings.join()).toContain('maybe')
  })
})

describe('parseImportDate', () => {
  it.each([
    ['2026-11-20 20:00', '2026-11-20T12:00:00.000Z'],
    ['2026-11-20T20:00', '2026-11-20T12:00:00.000Z'],
    ['2026-11-20', '2026-11-19T16:00:00.000Z'],
    ['2026-11-20T20:00:00+08:00', '2026-11-20T12:00:00.000Z'],
    ['2026-11-20T12:00:00Z', '2026-11-20T12:00:00.000Z'],
  ])('%s', (input, iso) => {
    expect(parseImportDate(input)?.toISOString()).toBe(iso)
  })
  it('看不懂 → null', () => expect(parseImportDate('下週五')).toBeNull())
})

describe('圖片網址工具', () => {
  it('collect + rewrite：換掉對照表裡的、null 的整張移除（含空殼 <p>）', () => {
    const html = '<p><img src="a"></p><p>文字<img src="b"></p><p><img src="c"></p>'
    expect(collectImageSrcs(html)).toEqual(['a', 'b', 'c'])
    const out = rewriteImageSrcs(html, new Map([['a', '/uploads/posts/x/1.webp'], ['b', null]]))
    expect(out).toBe('<p><img src="/uploads/posts/x/1.webp"></p><p>文字</p><p><img src="c"></p>')
  })
})

describe('下載範本', () => {
  it('範本本身就能匯入，示範的欄位都讀得到', async () => {
    const { IMPORT_TEMPLATE } = await import('@/app/admin/journal/import-template')
    const p = parsePostHtml(IMPORT_TEMPLATE)
    expect(p).toMatchObject({
      title: '秋冬睡衣穿搭指南',
      slug: 'autumn-pajama-guide',
      status: 'DRAFT',
      tags: ['穿搭', '秋冬', '睡衣'],
      coverImageSrc: 'https://example.com/cover.jpg',
    })
    expect(p.translations.map((t) => t.locale)).toEqual(['en'])
    expect(p.bodyHtml).toContain('{{product:商品網址代稱}}')
    expect(p.bodyHtml).not.toContain('<h1')
    expect(p.warnings).toEqual([])
  })
})
