'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { locales } from '@/i18n/config'
import { slugify } from '@/lib/utils'
import { savePostImages, deletePostImageDir, MAX_FILES_PER_UPLOAD } from '@/lib/uploads'
import { extractProductSlugs } from '@/lib/journal/html'
import { productCardHtml } from '@/lib/journal/render'
import { PRODUCT_CARD_SELECT } from '@/lib/catalog/queries'
import { TRANSLATION_LOCALES } from '@/lib/journal/queries'
import { parseTags, parseTaipeiDateTime } from '@/lib/journal/form'

export type PostFormState = {
  ok: boolean
  message?: string
  error?: string
  /** 存檔成功但值得提醒的事，例如內文嵌了已下架的商品 */
  warnings?: string[]
  fieldErrors?: Record<string, string>
  redirectTo?: string
}

const MAX_BODY = 200_000

function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) out[String(issue.path[0] ?? '_')] ??= issue.message
  return out
}

/**
 * 前台文章頁都是動態渲染，這裡清的主要是後台列表；前台的內部路徑也一併清，
 * 日後若改成 ISR 才不會漏。localePrefix: never 的內部路徑仍帶語系前綴（見商品 actions 的說明）。
 */
function revalidateJournal(slugs: (string | null | undefined)[] = []): void {
  revalidatePath('/admin/journal')
  for (const locale of locales) {
    revalidatePath(`/${locale}/journal`)
    for (const slug of slugs) if (slug) revalidatePath(`/${locale}/journal/${slug}`)
  }
}

async function slugTaken(slug: string, exceptId?: string): Promise<boolean> {
  const row = await db.post.findUnique({ where: { slug }, select: { id: true } })
  return row !== null && row.id !== exceptId
}

/** 由標題產生還沒被用掉的 slug；撞名往後加 -2、-3。 */
async function uniquePostSlug(title: string): Promise<string> {
  const base = slugify(title) || `post-${Date.now().toString(36)}`
  for (let n = 1; n <= 50; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`
    if (!(await slugTaken(candidate))) return candidate
  }
  return `${base}-${Date.now().toString(36)}`
}

/** 內文嵌入的商品裡，找不到或沒上架的那些（存檔時提醒，前台會自動略過）。 */
async function missingEmbeds(...htmls: string[]): Promise<string[]> {
  const slugs = [...new Set(htmls.flatMap((h) => extractProductSlugs(h)))]
  if (slugs.length === 0) return []
  const found = await db.product.findMany({
    where: { slug: { in: slugs }, status: 'ACTIVE' },
    select: { slug: true },
  })
  const ok = new Set(found.map((p) => p.slug))
  return slugs.filter((s) => !ok.has(s))
}

// ---------------------------------------------------------------------------
// 新增
// ---------------------------------------------------------------------------

const createSchema = z.object({
  title: z.string().trim().min(1, '請輸入標題').max(200, '標題最多 200 字'),
})

/** 先建一篇只有標題的草稿再進編輯頁 —— 圖片要放在文章自己的資料夾底下，得先有 id。 */
export async function createPost(_prev: PostFormState, formData: FormData): Promise<PostFormState> {
  const admin = await requireAdmin()

  const parsed = createSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) }

  try {
    const slug = await uniquePostSlug(parsed.data.title)
    const post = await db.post.create({
      data: { title: parsed.data.title, slug, bodyHtml: '', status: 'DRAFT' },
      select: { id: true, slug: true },
    })

    await audit({
      userId: admin.id,
      action: 'post.create',
      entity: 'Post',
      entityId: post.id,
      after: { title: parsed.data.title, slug },
    })

    revalidateJournal()
    return { ok: true, message: '草稿已建立', redirectTo: `/admin/journal/${post.id}` }
  } catch (error) {
    console.error('[admin] 建立文章失敗', error)
    return { ok: false, error: '建立文章失敗，請稍後再試' }
  }
}

// ---------------------------------------------------------------------------
// 編輯
// ---------------------------------------------------------------------------

const updateSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1, '請輸入標題').max(200, '標題最多 200 字'),
  slug: z.string().trim().min(1, '請輸入網址代稱').max(120, '網址代稱最多 120 字'),
  excerpt: z.string().trim().max(500, '摘要最多 500 字').optional().default(''),
  bodyHtml: z.string().max(MAX_BODY, '內文太長了（上限 20 萬字元）').optional().default(''),
  coverImageUrl: z.string().trim().max(500).optional().default(''),
  tags: z.string().max(1000).optional().default(''),
  status: z.enum(['DRAFT', 'PUBLISHED']),
  publishedAt: z.string().trim().optional().default(''),
  seoTitle: z.string().trim().max(200).optional().default(''),
  seoDescription: z.string().trim().max(300).optional().default(''),
})

export async function updatePost(_prev: PostFormState, formData: FormData): Promise<PostFormState> {
  const admin = await requireAdmin()

  const parsed = updateSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) }
  const data = parsed.data

  // slug 一律正規化：空白變連字號、去掉標點，避免貼上帶空格或問號的網址
  const slug = slugify(data.slug)
  if (!slug) return { ok: false, fieldErrors: { slug: '網址代稱只能有文字、數字和連字號' } }

  // 封面只收本站上傳的圖或 https 圖片，擋掉 javascript: 之類塞進 <img src> / og:image 的值
  if (data.coverImageUrl && !/^(\/uploads\/|https:\/\/)/.test(data.coverImageUrl)) {
    return { ok: false, fieldErrors: { coverImageUrl: '封面圖片網址不正確' } }
  }

  let publishedAt: Date | null = null
  if (data.publishedAt) {
    publishedAt = parseTaipeiDateTime(data.publishedAt)
    if (!publishedAt) return { ok: false, fieldErrors: { publishedAt: '發布時間格式不正確' } }
  }

  try {
    const before = await db.post.findUnique({
      where: { id: data.id },
      select: {
        title: true,
        slug: true,
        status: true,
        publishedAt: true,
        tags: true,
        coverImageUrl: true,
        excerpt: true,
        seoTitle: true,
        seoDescription: true,
      },
    })
    if (!before) return { ok: false, error: '找不到這篇文章' }

    if (await slugTaken(slug, data.id)) {
      return { ok: false, fieldErrors: { slug: '這個網址代稱已經被其他文章用了' } }
    }

    // 發布時沒填時間就用現在；已經發布過的保留原本的時間，改錯字不會讓舊文章跳回第一篇
    if (data.status === 'PUBLISHED' && !publishedAt) publishedAt = before.publishedAt ?? new Date()

    const tags = parseTags(data.tags)
    const after = {
      title: data.title,
      slug,
      status: data.status,
      publishedAt,
      tags,
      coverImageUrl: data.coverImageUrl || null,
      excerpt: data.excerpt || null,
      seoTitle: data.seoTitle || null,
      seoDescription: data.seoDescription || null,
    }

    await db.post.update({ where: { id: data.id }, data: { ...after, bodyHtml: data.bodyHtml } })

    await audit({
      userId: admin.id,
      action: 'post.update',
      entity: 'Post',
      entityId: data.id,
      before,
      // 內文可以很長，稽核紀錄只記長度
      after: { ...after, bodyLength: data.bodyHtml.length },
    })

    revalidateJournal([before.slug, slug])

    const warnings: string[] = []
    const missing = await missingEmbeds(data.bodyHtml)
    if (missing.length > 0) {
      warnings.push(`內文嵌入的商品找不到或未上架，前台不會顯示：${missing.join('、')}`)
    }
    if (before.slug !== slug && before.status === 'PUBLISHED') {
      warnings.push('網址代稱改了，分享出去的舊連結會失效')
    }
    if (data.status === 'PUBLISHED' && publishedAt && publishedAt > new Date()) {
      warnings.push('發布時間在未來，時間到了才會出現在前台')
    }

    return { ok: true, message: '文章已儲存', warnings }
  } catch (error) {
    console.error('[admin] 更新文章失敗', error)
    return { ok: false, error: '儲存失敗，請稍後再試' }
  }
}

// ---------------------------------------------------------------------------
// 譯文
// ---------------------------------------------------------------------------

const translationSchema = z.object({
  postId: z.string().min(1),
  locale: z.enum(TRANSLATION_LOCALES),
  title: z.string().trim().max(200, '標題最多 200 字').optional().default(''),
  excerpt: z.string().trim().max(500, '摘要最多 500 字').optional().default(''),
  bodyHtml: z.string().max(MAX_BODY, '內文太長了').optional().default(''),
})

/**
 * 儲存一個語系的譯文。標題與內文都清空 = 刪除譯文（該語系改回顯示中文）。
 * 只填一半的不收：前台只認「標題和內文都有」的譯文，存了也不會出現，不如當場講清楚。
 */
export async function savePostTranslation(
  _prev: PostFormState,
  formData: FormData,
): Promise<PostFormState> {
  const admin = await requireAdmin()

  const parsed = translationSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) }
  const { postId, locale, title, excerpt, bodyHtml } = parsed.data
  const hasBody = bodyHtml.trim().length > 0

  try {
    const post = await db.post.findUnique({ where: { id: postId }, select: { slug: true } })
    if (!post) return { ok: false, error: '找不到這篇文章' }

    if (!title && !hasBody) {
      const { count } = await db.postTranslation.deleteMany({ where: { postId, locale } })
      if (count > 0) {
        await audit({
          userId: admin.id,
          action: 'post.translation.delete',
          entity: 'Post',
          entityId: postId,
          before: { locale },
        })
      }
      revalidateJournal([post.slug])
      return { ok: true, message: '已移除譯文，這個語系會顯示中文原文' }
    }

    if (!title) return { ok: false, fieldErrors: { title: '有內文就要有標題' } }
    if (!hasBody) return { ok: false, fieldErrors: { bodyHtml: '有標題就要有內文' } }

    await db.postTranslation.upsert({
      where: { postId_locale: { postId, locale } },
      create: { postId, locale, title, excerpt: excerpt || null, bodyHtml },
      update: { title, excerpt: excerpt || null, bodyHtml },
    })

    await audit({
      userId: admin.id,
      action: 'post.translation.save',
      entity: 'Post',
      entityId: postId,
      after: { locale, title, bodyLength: bodyHtml.length },
    })

    revalidateJournal([post.slug])

    const missing = await missingEmbeds(bodyHtml)
    return {
      ok: true,
      message: '譯文已儲存',
      warnings:
        missing.length > 0
          ? [`內文嵌入的商品找不到或未上架，前台不會顯示：${missing.join('、')}`]
          : [],
    }
  } catch (error) {
    console.error('[admin] 儲存譯文失敗', error)
    return { ok: false, error: '儲存失敗，請稍後再試' }
  }
}

// ---------------------------------------------------------------------------
// 刪除
// ---------------------------------------------------------------------------

export async function deletePost(postId: string): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin()

  try {
    const post = await db.post.findUnique({
      where: { id: postId },
      select: { title: true, slug: true, status: true, publishedAt: true },
    })
    if (!post) return { ok: false, error: '找不到這篇文章' }

    await db.post.delete({ where: { id: postId } })
    await deletePostImageDir(postId)

    await audit({
      userId: admin.id,
      action: 'post.delete',
      entity: 'Post',
      entityId: postId,
      before: post,
    })

    revalidateJournal([post.slug])
    return { ok: true }
  } catch (error) {
    console.error('[admin] 刪除文章失敗', error)
    return { ok: false, error: '刪除失敗，請稍後再試' }
  }
}

// ---------------------------------------------------------------------------
// 圖片與商品嵌入（編輯器工具列用）
// ---------------------------------------------------------------------------

export async function uploadPostImages(formData: FormData): Promise<{
  ok: boolean
  error?: string
  images?: { url: string; width: number; height: number }[]
  failures?: { filename: string; reason: string }[]
}> {
  const admin = await requireAdmin()

  const postId = String(formData.get('postId') ?? '')
  if (!postId) return { ok: false, error: '缺少文章識別碼' }

  const files = formData.getAll('images').filter((f): f is File => f instanceof File)
  if (files.length === 0 || files.every((f) => f.size === 0)) {
    return { ok: false, error: '請選擇要上傳的圖片' }
  }
  if (files.length > MAX_FILES_PER_UPLOAD) {
    return { ok: false, error: `一次最多上傳 ${MAX_FILES_PER_UPLOAD} 張` }
  }

  try {
    const post = await db.post.findUnique({ where: { id: postId }, select: { id: true } })
    if (!post) return { ok: false, error: '找不到這篇文章' }

    const { saved, failed } = await savePostImages(postId, files)

    if (saved.length > 0) {
      await audit({
        userId: admin.id,
        action: 'post.images.upload',
        entity: 'Post',
        entityId: postId,
        after: { count: saved.length, urls: saved.map((s) => s.url) },
      })
    }

    if (saved.length === 0) return { ok: false, error: '沒有任何圖片上傳成功', failures: failed }

    return {
      ok: true,
      images: saved.map(({ url, width, height }) => ({ url, width, height })),
      failures: failed.length > 0 ? failed : undefined,
    }
  } catch (error) {
    console.error('[admin] 上傳文章圖片失敗', error)
    return { ok: false, error: '上傳失敗，請稍後再試' }
  }
}

export type EmbeddableProduct = {
  slug: string
  name: string
  imageUrl: string | null
  status: string
}

/** 「插入商品」的搜尋框：依名稱或 slug 找，上架中的排前面。 */
export async function searchProductsForEmbed(query: string): Promise<EmbeddableProduct[]> {
  await requireAdmin()

  const q = query.trim().slice(0, 100)
  const rows = await db.product.findMany({
    where: q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { nameEn: { contains: q, mode: 'insensitive' } },
            { slug: { contains: q, mode: 'insensitive' } },
          ],
        }
      : { status: 'ACTIVE' },
    select: {
      slug: true,
      name: true,
      status: true,
      images: { select: { url: true }, orderBy: { sortOrder: 'asc' }, take: 1 },
    },
    orderBy: [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    take: 12,
  })

  // 上架中的排前面。不能交給 orderBy status：Postgres 的 enum 依宣告順序排，DRAFT 會在最前面
  rows.sort((a, b) => Number(b.status === 'ACTIVE') - Number(a.status === 'ACTIVE'))

  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    imageUrl: r.images[0]?.url ?? null,
    status: r.status,
  }))
}

/**
 * 編輯器預覽用：把內文裡嵌入的商品卡片先在伺服器組好 HTML 傳回去。
 * 卡片 HTML 由 productCardHtml 產生（所有欄位都跳脫過），預覽與前台長得一模一樣。
 */
export async function previewEmbeddedProducts(slugs: string[]): Promise<Record<string, string>> {
  await requireAdmin()

  const wanted = [...new Set(slugs)].slice(0, 50)
  if (wanted.length === 0) return {}

  const products = await db.product.findMany({
    where: { slug: { in: wanted }, status: 'ACTIVE' },
    select: PRODUCT_CARD_SELECT,
  })
  return Object.fromEntries(
    products.map((p) => [p.slug, productCardHtml(p, 'zh-TW', { view: '查看商品', soldOut: '已售完' })]),
  )
}
