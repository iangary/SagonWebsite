import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', async () => (await import('./mocks')).authMockModule())
vi.mock('next/cache', async () => (await import('./mocks')).nextCacheMockModule())
vi.mock('next/headers', async () => (await import('./mocks')).nextHeadersMockModule())

// 只 mock 碰磁碟的函式
const { savePostImagesMock, deletePostImageDirMock } = vi.hoisted(() => ({
  savePostImagesMock: vi.fn(),
  deletePostImageDirMock: vi.fn(async () => {}),
}))
vi.mock('@/lib/uploads', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/uploads')>()
  return { ...actual, savePostImages: savePostImagesMock, deletePostImageDir: deletePostImageDirMock }
})

import { db } from '@/lib/db'
import {
  createPost,
  deletePost,
  previewEmbeddedProducts,
  savePostTranslation,
  searchProductsForEmbed,
  updatePost,
  uploadPostImages,
  type PostFormState,
} from '@/app/admin/journal/actions'
import {
  getPublishedPostBySlug,
  getRelatedPosts,
  listPublishedPosts,
  listPublishedTags,
  localizePost,
} from '@/lib/journal/queries'
import { renderPostBody } from '@/lib/journal/render'
import sitemap from '@/app/sitemap'
import { createTestProduct, createTestUser } from '../factories'
import { mockAuthUser, resetCookieJar, revalidatePathMock } from './mocks'
import type { User } from '@prisma/client'

/**
 * 專欄文章：後台 CRUD（含稽核紀錄）、前台只看得到已發布的文章、內文消毒與商品卡片。
 * requireAdmin 走 mock，但 admin 是真實 User 列，audit_logs 的 FK 才立得住。
 */

const EMPTY: PostFormState = { ok: false }
const LABELS = { view: '查看商品', soldOut: '已售完' }

function form(entries: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(entries)) fd.append(k, v)
  return fd
}

/** 直接寫一篇文章進資料庫（測查詢用，不經過 action）。 */
async function seedPost(data: {
  slug: string
  title?: string
  status?: 'DRAFT' | 'PUBLISHED'
  publishedAt?: Date | null
  tags?: string[]
  bodyHtml?: string
}) {
  return db.post.create({
    data: {
      slug: data.slug,
      title: data.title ?? data.slug,
      bodyHtml: data.bodyHtml ?? `<p>${data.slug} 內文</p>`,
      status: data.status ?? 'PUBLISHED',
      publishedAt: data.publishedAt === undefined ? new Date(Date.now() - 60_000) : data.publishedAt,
      tags: data.tags ?? [],
    },
  })
}

/** 編輯表單的完整欄位（updatePost 要的形狀），可覆寫任一欄。 */
function updateForm(id: string, overrides: Record<string, string> = {}): FormData {
  return form({
    id,
    title: '春季睡衣穿搭',
    slug: 'spring-pajamas',
    excerpt: '',
    bodyHtml: '<p>內文</p>',
    coverImageUrl: '',
    tags: '',
    status: 'DRAFT',
    publishedAt: '',
    seoTitle: '',
    seoDescription: '',
    ...overrides,
  })
}

let admin: User

beforeEach(async () => {
  resetCookieJar()
  revalidatePathMock.mockClear()
  savePostImagesMock.mockReset()
  deletePostImageDirMock.mockClear()
  admin = await createTestUser({ role: 'ADMIN' })
  mockAuthUser({ id: admin.id, role: 'ADMIN' })
})

describe('權限', () => {
  it('未登入與一般會員：所有後台動作都拒絕，也不留稽核紀錄', async () => {
    const post = await seedPost({ slug: 'p' })

    for (const user of [null, { id: (await createTestUser()).id, role: 'CUSTOMER' as const }]) {
      mockAuthUser(user)
      await expect(createPost(EMPTY, form({ title: 'x' }))).rejects.toThrow('FORBIDDEN')
      await expect(updatePost(EMPTY, updateForm(post.id))).rejects.toThrow('FORBIDDEN')
      await expect(
        savePostTranslation(EMPTY, form({ postId: post.id, locale: 'en', title: 'x', bodyHtml: '<p>x</p>' })),
      ).rejects.toThrow('FORBIDDEN')
      await expect(deletePost(post.id)).rejects.toThrow('FORBIDDEN')
      await expect(uploadPostImages(form({ postId: post.id }))).rejects.toThrow('FORBIDDEN')
      await expect(searchProductsForEmbed('')).rejects.toThrow('FORBIDDEN')
      await expect(previewEmbeddedProducts(['a'])).rejects.toThrow('FORBIDDEN')
    }

    expect(await db.post.count()).toBe(1)
    expect(await db.auditLog.count()).toBe(0)
  })
})

describe('createPost', () => {
  it('建立草稿、slug 由標題產生、撞名加 -2、寫稽核紀錄', async () => {
    const a = await createPost(EMPTY, form({ title: 'Spring Pajamas 穿搭' }))
    await createPost(EMPTY, form({ title: 'Spring Pajamas 穿搭' }))

    expect(a.ok).toBe(true)
    const posts = await db.post.findMany({ orderBy: { createdAt: 'asc' } })
    expect(posts.map((p) => p.slug)).toEqual(['spring-pajamas-穿搭', 'spring-pajamas-穿搭-2'])
    expect(posts[0]!.status).toBe('DRAFT')
    expect(posts[0]!.publishedAt).toBeNull()
    expect(a.redirectTo).toBe(`/admin/journal/${posts[0]!.id}`)

    const logs = await db.auditLog.findMany({ where: { action: 'post.create' } })
    expect(logs).toHaveLength(2)
    expect(logs[0]!.userId).toBe(admin.id)
  })

  it('沒有標題 → 欄位錯誤，不建立', async () => {
    const state = await createPost(EMPTY, form({ title: '  ' }))
    expect(state.ok).toBe(false)
    expect(state.fieldErrors?.title).toBeTruthy()
    expect(await db.post.count()).toBe(0)
  })
})

describe('updatePost', () => {
  it('儲存所有欄位：標籤拆開、slug 正規化、發布時沒填時間補現在、稽核記前後值', async () => {
    const post = await seedPost({ slug: 'draft', status: 'DRAFT', publishedAt: null })
    const before = Date.now()

    const state = await updatePost(
      EMPTY,
      updateForm(post.id, {
        slug: 'Spring Pajamas?',
        tags: '穿搭、新品, #睡衣',
        status: 'PUBLISHED',
        excerpt: '摘要',
        coverImageUrl: '/uploads/posts/x/cover.webp',
        seoTitle: 'SEO 標題',
      }),
    )
    expect(state).toMatchObject({ ok: true })

    const saved = await db.post.findUniqueOrThrow({ where: { id: post.id } })
    expect(saved).toMatchObject({
      title: '春季睡衣穿搭',
      slug: 'spring-pajamas',
      tags: ['穿搭', '新品', '睡衣'],
      status: 'PUBLISHED',
      excerpt: '摘要',
      coverImageUrl: '/uploads/posts/x/cover.webp',
      seoTitle: 'SEO 標題',
      bodyHtml: '<p>內文</p>',
    })
    expect(saved.publishedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000)

    const log = await db.auditLog.findFirstOrThrow({ where: { action: 'post.update', entityId: post.id } })
    expect(log.before).toMatchObject({ slug: 'draft', status: 'DRAFT' })
    expect(log.after).toMatchObject({ slug: 'spring-pajamas', status: 'PUBLISHED', bodyLength: 9 })
    expect(revalidatePathMock).toHaveBeenCalledWith('/admin/journal')
  })

  it('已發布的文章再存一次，不會把發布時間改成現在', async () => {
    const original = new Date('2026-01-01T00:00:00Z')
    const post = await seedPost({ slug: 'old', publishedAt: original })
    await updatePost(EMPTY, updateForm(post.id, { slug: 'old', status: 'PUBLISHED' }))
    const saved = await db.post.findUniqueOrThrow({ where: { id: post.id } })
    expect(saved.publishedAt!.toISOString()).toBe(original.toISOString())
  })

  it('發布時間以台北時間解讀；未來時間會提醒是排程', async () => {
    const post = await seedPost({ slug: 'p', status: 'DRAFT', publishedAt: null })
    const state = await updatePost(
      EMPTY,
      updateForm(post.id, { slug: 'p', status: 'PUBLISHED', publishedAt: '2099-01-01T20:00' }),
    )
    const saved = await db.post.findUniqueOrThrow({ where: { id: post.id } })
    expect(saved.publishedAt!.toISOString()).toBe('2099-01-01T12:00:00.000Z')
    expect(state.warnings?.join()).toContain('未來')
  })

  it('slug 被別篇用了 → 欄位錯誤，資料不變', async () => {
    await seedPost({ slug: 'taken' })
    const post = await seedPost({ slug: 'mine' })
    const state = await updatePost(EMPTY, updateForm(post.id, { slug: 'taken' }))
    expect(state.fieldErrors?.slug).toBeTruthy()
    expect((await db.post.findUniqueOrThrow({ where: { id: post.id } })).slug).toBe('mine')
  })

  it('封面網址不是本站上傳或 https → 拒絕', async () => {
    const post = await seedPost({ slug: 'p' })
    const state = await updatePost(
      EMPTY,
      updateForm(post.id, { slug: 'p', coverImageUrl: 'javascript:alert(1)' }),
    )
    expect(state.fieldErrors?.coverImageUrl).toBeTruthy()
  })

  it('內文嵌入的商品找不到或未上架 → 存檔成功但提醒', async () => {
    const { product: active } = await createTestProduct()
    const { product: draft } = await createTestProduct({ status: 'DRAFT' })
    const post = await seedPost({ slug: 'p' })

    const state = await updatePost(
      EMPTY,
      updateForm(post.id, {
        slug: 'p',
        bodyHtml: `<p>{{product:${active.slug}}}</p><p>{{product:${draft.slug}}}</p><p>{{product:nope}}</p>`,
      }),
    )
    expect(state.ok).toBe(true)
    expect(state.warnings?.[0]).toContain(draft.slug)
    expect(state.warnings?.[0]).toContain('nope')
    expect(state.warnings?.[0]).not.toContain(active.slug)
  })
})

describe('譯文', () => {
  it('儲存、更新、清空即刪除，每次都留稽核紀錄', async () => {
    const post = await seedPost({ slug: 'p' })

    const saved = await savePostTranslation(
      EMPTY,
      form({ postId: post.id, locale: 'en', title: 'Hello', excerpt: '', bodyHtml: '<p>Hi</p>' }),
    )
    expect(saved.ok).toBe(true)
    await savePostTranslation(
      EMPTY,
      form({ postId: post.id, locale: 'en', title: 'Hello 2', excerpt: '', bodyHtml: '<p>Hi</p>' }),
    )
    expect(await db.postTranslation.findMany({ where: { postId: post.id } })).toMatchObject([
      { locale: 'en', title: 'Hello 2' },
    ])

    const cleared = await savePostTranslation(
      EMPTY,
      form({ postId: post.id, locale: 'en', title: '', excerpt: '', bodyHtml: '' }),
    )
    expect(cleared.ok).toBe(true)
    expect(await db.postTranslation.count()).toBe(0)

    const actions = (await db.auditLog.findMany({ orderBy: { createdAt: 'asc' } })).map((l) => l.action)
    expect(actions).toEqual(['post.translation.save', 'post.translation.save', 'post.translation.delete'])
  })

  it('只填標題或只填內文 → 拒絕；不支援的語系 → 拒絕', async () => {
    const post = await seedPost({ slug: 'p' })
    const onlyTitle = await savePostTranslation(
      EMPTY,
      form({ postId: post.id, locale: 'ja', title: 'タイトル', bodyHtml: '' }),
    )
    expect(onlyTitle.fieldErrors?.bodyHtml).toBeTruthy()
    const badLocale = await savePostTranslation(
      EMPTY,
      form({ postId: post.id, locale: 'zh-TW', title: 'x', bodyHtml: '<p>x</p>' }),
    )
    expect(badLocale.ok).toBe(false)
    expect(await db.postTranslation.count()).toBe(0)
  })
})

describe('deletePost', () => {
  it('刪除文章、譯文跟著刪、圖片資料夾移除、稽核紀錄保留標題', async () => {
    const post = await seedPost({ slug: 'bye', title: '要刪的文章' })
    await db.postTranslation.create({
      data: { postId: post.id, locale: 'en', title: 'Bye', bodyHtml: '<p>x</p>' },
    })

    expect(await deletePost(post.id)).toEqual({ ok: true })
    expect(await db.post.count()).toBe(0)
    expect(await db.postTranslation.count()).toBe(0)
    expect(deletePostImageDirMock).toHaveBeenCalledWith(post.id)

    const log = await db.auditLog.findFirstOrThrow({ where: { action: 'post.delete' } })
    expect(log.entityId).toBe(post.id)
    expect(log.before).toMatchObject({ title: '要刪的文章', slug: 'bye' })
  })

  it('不存在的文章 → 錯誤，不呼叫刪檔', async () => {
    expect(await deletePost('nope')).toMatchObject({ ok: false })
    expect(deletePostImageDirMock).not.toHaveBeenCalled()
  })
})

describe('uploadPostImages', () => {
  it('存到文章資料夾並記稽核', async () => {
    const post = await seedPost({ slug: 'p' })
    savePostImagesMock.mockResolvedValue({
      saved: [{ url: `/uploads/posts/${post.id}/a.webp`, width: 800, height: 600, bytes: 1 }],
      failed: [],
    })
    const fd = new FormData()
    fd.set('postId', post.id)
    fd.append('images', new File([new Uint8Array([1, 2, 3])], 'a.jpg', { type: 'image/jpeg' }))

    const result = await uploadPostImages(fd)
    expect(result).toMatchObject({ ok: true, images: [{ url: `/uploads/posts/${post.id}/a.webp` }] })
    expect(savePostImagesMock).toHaveBeenCalledWith(post.id, expect.any(Array))
    expect(await db.auditLog.count({ where: { action: 'post.images.upload' } })).toBe(1)
  })
})

describe('前台查詢：只看得到已發布、時間已到的文章', () => {
  it('草稿與排程中的文章不出現在列表、內頁、標籤、sitemap', async () => {
    const old = await seedPost({ slug: 'old', tags: ['穿搭'], publishedAt: new Date('2026-01-01') })
    const recent = await seedPost({ slug: 'recent', tags: ['穿搭', '新品'] })
    await seedPost({ slug: 'draft', status: 'DRAFT', tags: ['草稿標籤'] })
    await seedPost({ slug: 'future', publishedAt: new Date(Date.now() + 86_400_000), tags: ['未來'] })

    const list = await listPublishedPosts({ locale: 'zh-TW' })
    expect(list.posts.map((p) => p.slug)).toEqual([recent.slug, old.slug])
    expect(list.total).toBe(2)

    expect(await getPublishedPostBySlug('recent')).not.toBeNull()
    expect(await getPublishedPostBySlug('draft')).toBeNull()
    expect(await getPublishedPostBySlug('future')).toBeNull()

    expect(await listPublishedTags()).toEqual([
      { tag: '穿搭', count: 2 },
      { tag: '新品', count: 1 },
    ])

    const tagged = await listPublishedPosts({ locale: 'zh-TW', tag: '新品' })
    expect(tagged.posts.map((p) => p.slug)).toEqual(['recent'])

    const urls = (await sitemap()).map((e) => e.url)
    expect(urls).toContain('http://localhost:3000/journal')
    expect(urls).toContain('http://localhost:3000/journal/recent')
    expect(urls.some((u) => u.endsWith('/journal/draft') || u.endsWith('/journal/future'))).toBe(false)
  })

  it('分頁：超出範圍的頁碼收回最後一頁', async () => {
    for (let i = 0; i < 5; i++) {
      await seedPost({ slug: `p${i}`, publishedAt: new Date(Date.UTC(2026, 0, i + 1)) })
    }
    const page2 = await listPublishedPosts({ locale: 'zh-TW', page: 2, perPage: 2 })
    expect(page2.posts.map((p) => p.slug)).toEqual(['p2', 'p1'])
    expect(page2.totalPages).toBe(3)
    const beyond = await listPublishedPosts({ locale: 'zh-TW', page: 99, perPage: 2 })
    expect(beyond.page).toBe(3)
    expect(beyond.posts.map((p) => p.slug)).toEqual(['p0'])
  })

  it('相關文章：同標籤優先，不足用最新文章補，不含自己與草稿', async () => {
    const me = await seedPost({ slug: 'me', tags: ['穿搭'] })
    await seedPost({ slug: 'same', tags: ['穿搭'], publishedAt: new Date('2026-01-01') })
    await seedPost({ slug: 'other', tags: ['保養'] })
    await seedPost({ slug: 'draft', status: 'DRAFT', tags: ['穿搭'] })

    const related = await getRelatedPosts(me, 'zh-TW', 3)
    expect(related.map((p) => p.slug)).toEqual(['same', 'other'])
  })
})

describe('譯文顯示', () => {
  it('有完整譯文顯示譯文，否則整篇中文；摘要留白取內文開頭', async () => {
    const post = await seedPost({ slug: 'p', title: '中文標題', bodyHtml: '<p>中文內文</p>' })
    await db.postTranslation.createMany({
      data: [
        { postId: post.id, locale: 'en', title: 'English', bodyHtml: '<p>English body</p>' },
        { postId: post.id, locale: 'ja', title: '日本語', bodyHtml: '  ' },
      ],
    })
    const row = (await getPublishedPostBySlug('p'))!

    expect(localizePost(row, 'en')).toMatchObject({ title: 'English', excerpt: 'English body', locale: 'en' })
    // 日文譯文內文是空的 → 不算數，整篇中文
    expect(localizePost(row, 'ja')).toMatchObject({ title: '中文標題', locale: 'zh-TW' })
    expect(localizePost(row, 'ko')).toMatchObject({ title: '中文標題', excerpt: '中文內文' })

    const list = await listPublishedPosts({ locale: 'en' })
    expect(list.posts[0]!.title).toBe('English')
  })
})

describe('renderPostBody', () => {
  it('消毒 XSS，並把上架商品換成卡片（欄位跳脫）、未上架與不存在的短碼移除', async () => {
    const { product } = await createTestProduct({ name: '<img src=x onerror=alert(1)>睡衣', price: 990 })
    const { product: draft } = await createTestProduct({ status: 'DRAFT' })

    const html = await renderPostBody(
      '<script>alert(1)</script>' +
        '<p onmouseover="alert(1)">前言</p>' +
        `<p>{{product:${product.slug}}}</p>` +
        `<p>{{product:${draft.slug}}}</p>` +
        '<p>{{product:missing}}</p>' +
        '<a href="javascript:alert(1)">壞連結</a>',
      'zh-TW',
      LABELS,
    )

    // 商品名稱裡的 <img onerror> 必須是跳脫後的文字，不能是真的標籤
    expect(html).not.toContain('<img src=x')
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toContain('onmouseover')
    expect(html).not.toContain('javascript:')
    expect(html).toContain(`href="/product/${product.slug}"`)
    expect(html).toContain('class="journal-product"')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;睡衣')
    expect(html).toContain('NT$990')
    expect(html).toContain('查看商品')
    expect(html).not.toContain(draft.slug)
    expect(html).not.toContain('{{product:')
  })

  it('沒有嵌入商品時不查資料庫也能輸出', async () => {
    expect(await renderPostBody('<p>只有文字</p>', 'en', LABELS)).toBe('<p>只有文字</p>')
  })
})

describe('編輯器輔助', () => {
  it('searchProductsForEmbed 依名稱找，上架中的排前面；previewEmbeddedProducts 只回上架中的卡片', async () => {
    const { product: active } = await createTestProduct({ name: '絲質睡衣 A' })
    const { product: draft } = await createTestProduct({ name: '絲質睡衣 B', status: 'DRAFT' })
    await createTestProduct({ name: '棉質浴袍' })

    const found = await searchProductsForEmbed('絲質')
    expect(found.map((p) => p.slug)).toEqual([active.slug, draft.slug])

    const cards = await previewEmbeddedProducts([active.slug, draft.slug])
    expect(Object.keys(cards)).toEqual([active.slug])
    expect(cards[active.slug]).toContain('絲質睡衣 A')
  })
})
