import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', async () => (await import('./mocks')).authMockModule())
vi.mock('next/cache', async () => (await import('./mocks')).nextCacheMockModule())
vi.mock('next/headers', async () => (await import('./mocks')).nextHeadersMockModule())

const { savePostImagesMock, deletePostImageDirMock, lookupMock } = vi.hoisted(() => ({
  savePostImagesMock: vi.fn(),
  deletePostImageDirMock: vi.fn(async () => {}),
  lookupMock: vi.fn(),
}))
vi.mock('@/lib/uploads', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/uploads')>()
  return { ...actual, savePostImages: savePostImagesMock, deletePostImageDir: deletePostImageDirMock }
})
vi.mock('node:dns/promises', () => ({ lookup: lookupMock, default: { lookup: lookupMock } }))

import { db } from '@/lib/db'
import { POST as importRoute } from '@/app/api/admin/journal/import/route'
import { isPrivateAddress } from '@/lib/journal/import-images'
import { createTestProduct, createTestUser } from '../factories'
import { mockAuthUser } from './mocks'

/**
 * 「一個 HTML 檔就是一整篇文章」：匯入 API 的權限、欄位、圖片落地、覆蓋規則。
 * savePostImages 與 DNS 用 mock（不寫磁碟、不連網路），其餘走真實資料庫。
 */

let imageSeq = 0

function upload(html: string, postId?: string, name = 'post.html', type = 'text/html') {
  const form = new FormData()
  form.set('file', new File([html], name, { type }))
  if (postId) form.set('postId', postId)
  return importRoute(new Request('http://localhost/api/admin/journal/import', { method: 'POST', body: form }))
}

beforeEach(async () => {
  vi.restoreAllMocks()
  imageSeq = 0
  savePostImagesMock.mockReset()
  savePostImagesMock.mockImplementation(async (postId: string, files: File[]) => ({
    saved: files.map(() => ({ url: `/uploads/posts/${postId}/img-${++imageSeq}.webp`, width: 10, height: 10, bytes: 1 })),
    failed: [],
  }))
  deletePostImageDirMock.mockClear()
  lookupMock.mockReset()
  lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  const admin = await createTestUser({ role: 'ADMIN' })
  mockAuthUser({ id: admin.id, role: 'ADMIN' })
})

const PNG = 'data:image/png;base64,iVBORw0KGgo='

describe('權限與檔案檢查', () => {
  it('非管理員 403，什麼都不建', async () => {
    mockAuthUser({ id: (await createTestUser()).id, role: 'CUSTOMER' })
    const res = await upload('<title>T</title><p>x</p>')
    expect(res.status).toBe(403)
    expect(await db.post.count()).toBe(0)
  })

  it('沒有標題 → 400，不留空草稿', async () => {
    const res = await upload('<p>沒有標題</p>')
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('標題')
    expect(await db.post.count()).toBe(0)
  })

  it('不是 .html → 400', async () => {
    const res = await upload('<title>T</title><p>x</p>', undefined, 'post.txt', 'text/plain')
    expect(res.status).toBe(400)
  })
})

describe('新建', () => {
  it('一個檔案做好整篇：欄位、封面、內嵌圖片、譯文、商品卡片、稽核', async () => {
    const { product } = await createTestProduct()
    const html = `<!doctype html><html><head>
      <title>秋冬睡衣穿搭指南</title>
      <meta name="description" content="三個重點">
      <meta name="keywords" content="穿搭、秋冬">
      <meta name="slug" content="autumn-guide">
      <meta name="status" content="published">
      <meta name="date" content="2026-01-02 20:00">
      </head><body>
      <h1>秋冬睡衣穿搭指南</h1>
      <p><img src="${PNG}" alt="題圖"></p>
      <p>內文第一段</p>
      <p><img src="${PNG}#2" alt="內文圖"></p>
      <div data-product="${product.slug}"></div>
      <article lang="en"><h1>Autumn Guide</h1><p>English body</p></article>
      </body></html>`

    const res = await upload(html)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json).toMatchObject({ ok: true, created: true, status: 'PUBLISHED', imagesSaved: 2, translations: ['en'] })

    const post = await db.post.findUniqueOrThrow({
      where: { id: json.postId },
      include: { translations: true },
    })
    expect(post).toMatchObject({
      title: '秋冬睡衣穿搭指南',
      slug: 'autumn-guide',
      excerpt: '三個重點',
      tags: ['穿搭', '秋冬'],
      status: 'PUBLISHED',
      coverImageUrl: `/uploads/posts/${post.id}/img-1.webp`,
    })
    expect(post.publishedAt!.toISOString()).toBe('2026-01-02T12:00:00.000Z')
    // 題圖變成封面、從內文拿掉；內文圖換成站內網址；data-product 變短碼
    expect(post.bodyHtml).not.toContain('data:')
    expect(post.bodyHtml).not.toContain('<h1')
    expect(post.bodyHtml).toContain(`/uploads/posts/${post.id}/img-2.webp`)
    expect(post.bodyHtml).toContain(`{{product:${product.slug}}}`)
    expect(post.translations).toMatchObject([{ locale: 'en', title: 'Autumn Guide' }])

    const log = await db.auditLog.findFirstOrThrow({ where: { action: 'post.import' } })
    expect(log.entityId).toBe(post.id)
    expect(log.after).toMatchObject({ created: true, imagesSaved: 2, translations: ['en'] })
  })

  it('沒寫狀態 → 草稿；slug 被用了 → 自動加尾碼', async () => {
    await db.post.create({ data: { slug: 'taken', title: 'x', bodyHtml: '<p>x</p>' } })
    const json = await (await upload('<title>新文章</title><meta name="slug" content="taken"><p>x</p>')).json()
    const post = await db.post.findUniqueOrThrow({ where: { id: json.postId } })
    expect(post.status).toBe('DRAFT')
    expect(post.publishedAt).toBeNull()
    expect(post.slug).toBe('taken-2')
  })
})

describe('覆蓋既有文章', () => {
  it('標題內文換掉；檔案沒寫的欄位與其他語系譯文保留；slug 撞名提醒', async () => {
    await db.post.create({ data: { slug: 'other', title: 'o', bodyHtml: '<p>o</p>' } })
    const post = await db.post.create({
      data: {
        slug: 'mine',
        title: '舊標題',
        bodyHtml: '<p>舊內文</p>',
        tags: ['舊標籤'],
        excerpt: '舊摘要',
        status: 'PUBLISHED',
        publishedAt: new Date('2026-01-01T00:00:00Z'),
        translations: { create: [{ locale: 'ja', title: '旧', bodyHtml: '<p>旧</p>' }] },
      },
    })

    const res = await upload(
      '<title>新標題</title><meta name="slug" content="other"><p>新內文</p>' +
        '<article lang="en"><h1>New</h1><p>new</p></article>',
      post.id,
    )
    const json = await res.json()
    expect(json).toMatchObject({ ok: true, created: false })
    expect(json.warnings.join()).toContain('other')

    const after = await db.post.findUniqueOrThrow({ where: { id: post.id }, include: { translations: { orderBy: { locale: 'asc' } } } })
    expect(after).toMatchObject({
      title: '新標題',
      bodyHtml: '<p>新內文</p>',
      slug: 'mine',
      tags: ['舊標籤'],
      excerpt: '舊摘要',
      status: 'PUBLISHED',
    })
    expect(after.publishedAt!.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(after.translations.map((t) => t.locale)).toEqual(['en', 'ja'])
    expect(await db.post.count()).toBe(2)
  })

  it('不存在的 postId → 404', async () => {
    const res = await upload('<title>T</title><p>x</p>', 'nope')
    expect(res.status).toBe(404)
  })
})

describe('外部圖片', () => {
  it('公開網址下載後存到站上；內網位址拒絕並保留原網址；電腦路徑移除', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/jpeg' } }),
    )
    lookupMock.mockImplementation(async (host: string) =>
      host === 'internal.example' ? [{ address: '10.0.0.5', family: 4 }] : [{ address: '93.184.216.34', family: 4 }],
    )

    const json = await (
      await upload(
        '<title>T</title><p>文字在前</p>' +
          '<p><img src="https://cdn.example/a.jpg"></p>' +
          '<p><img src="https://internal.example/b.jpg"></p>' +
          '<p><img src="http://127.0.0.1/c.jpg"></p>' +
          '<p><img src="images/d.jpg"></p>',
      )
    ).json()

    const post = await db.post.findUniqueOrThrow({ where: { id: json.postId } })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(post.bodyHtml).toContain(`/uploads/posts/${post.id}/img-1.webp`)
    expect(post.bodyHtml).toContain('https://internal.example/b.jpg')
    expect(post.bodyHtml).toContain('http://127.0.0.1/c.jpg')
    expect(post.bodyHtml).not.toContain('images/d.jpg')
    expect(json.warnings.join('\n')).toMatch(/內部網路/)
    expect(json.warnings.join('\n')).toMatch(/電腦上的檔案/)
  })

  it('isPrivateAddress', () => {
    for (const ip of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '172.20.0.1', '192.168.1.1', '0.0.0.0', '::1', 'fd00::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true)
    }
    for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700::1111']) {
      expect(isPrivateAddress(ip), ip).toBe(false)
    }
  })
})
