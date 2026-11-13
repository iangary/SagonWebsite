import 'server-only'
import { db } from '@/lib/db'
import { deletePostImageDir } from '@/lib/uploads'
import { audit } from '@/lib/audit'
import { collectImageSrcs, parsePostHtml, rewriteImageSrcs } from './import'
import { localizeImages } from './import-images'
import { missingEmbeds, missingEmbedWarning, revalidateJournal, slugTaken, uniquePostSlug } from './admin'

export type ImportResult = {
  postId: string
  created: boolean
  title: string
  status: 'DRAFT' | 'PUBLISHED'
  imagesSaved: number
  translations: string[]
  warnings: string[]
}

/**
 * 用一個 HTML 檔建立或覆蓋一篇文章。
 *
 * 沒給 postId = 新建；給了 = 覆蓋那篇。覆蓋時：
 *   - 標題、內文一律換成檔案裡的
 *   - 摘要、標籤、網址代稱、狀態、發布時間、封面、SEO：檔案有寫才換，沒寫保留原值
 *   - 譯文：檔案裡有的語系整段換掉，沒有的語系保留
 * 狀態沒寫的新文章一律是草稿 —— 匯入不該在管理員沒說的情況下把文章公開。
 *
 * PostImportError（檔案本身有問題）由呼叫端轉成 400，其餘錯誤才是 500。
 */
export async function importPostFromHtml(input: {
  html: string
  postId?: string
  userId: string
}): Promise<ImportResult> {
  let createdId: string | null = null
  try {
    return await run(input, (id) => (createdId = id))
  } catch (error) {
    // 新建的那一筆是為了拿 id 才先建的，失敗就整筆收回，不留一篇空草稿
    if (createdId) {
      await db.post.delete({ where: { id: createdId } }).catch(() => {})
      await deletePostImageDir(createdId)
    }
    throw error
  }
}

async function run(
  { html, postId, userId }: { html: string; postId?: string; userId: string },
  onCreated: (id: string) => void,
): Promise<ImportResult> {
  const parsed = parsePostHtml(html)
  const warnings = [...parsed.warnings]

  const existing = postId
    ? await db.post.findUnique({
        where: { id: postId },
        select: { id: true, slug: true, status: true, publishedAt: true, coverImageUrl: true },
      })
    : null
  if (postId && !existing) throw new Error('找不到這篇文章')

  // 新文章先建一筆草稿拿 id —— 圖片要存在文章自己的資料夾底下
  const post =
    existing ??
    (await db.post.create({
      data: {
        title: parsed.title,
        slug: parsed.slug && !(await slugTaken(parsed.slug)) ? parsed.slug : await uniquePostSlug(parsed.slug ?? parsed.title),
        bodyHtml: '',
        status: 'DRAFT',
      },
      select: { id: true, slug: true, status: true, publishedAt: true, coverImageUrl: true },
    }))
  if (!existing) onCreated(post.id)

  // --- 圖片落地 -------------------------------------------------------------------
  const allSrcs = [
    ...(parsed.coverImageSrc ? [parsed.coverImageSrc] : []),
    ...collectImageSrcs(parsed.bodyHtml),
    ...parsed.translations.flatMap((t) => collectImageSrcs(t.bodyHtml)),
  ]
  const images = await localizeImages(post.id, allSrcs)
  warnings.push(...images.warnings)

  const bodyHtml = rewriteImageSrcs(parsed.bodyHtml, images.map)
  const translations = parsed.translations.map((t) => ({ ...t, bodyHtml: rewriteImageSrcs(t.bodyHtml, images.map) }))

  let coverImageUrl: string | null | undefined
  if (parsed.coverImageSrc) {
    const mapped = images.map.get(parsed.coverImageSrc)
    const src = mapped === undefined ? parsed.coverImageSrc : mapped
    // 封面只收站內路徑或 https（會出現在 og:image 與 <Image>）
    coverImageUrl = src && /^(\/(?!\/)|https:\/\/)/.test(src) ? src : null
    if (!coverImageUrl) warnings.push('封面圖片無法使用，這篇沒有封面')
  }

  // --- 網址代稱 -------------------------------------------------------------------
  let slug = post.slug
  if (parsed.slug && parsed.slug !== post.slug) {
    if (await slugTaken(parsed.slug, post.id)) {
      warnings.push(`網址代稱「${parsed.slug}」已經被其他文章用了，維持「${post.slug}」`)
    } else {
      if (existing?.status === 'PUBLISHED') warnings.push('網址代稱改了，分享出去的舊連結會失效')
      slug = parsed.slug
    }
  }

  // --- 狀態與發布時間 ---------------------------------------------------------------
  const status = parsed.status ?? (existing ? existing.status : 'DRAFT')
  let publishedAt = parsed.publishedAt ?? post.publishedAt
  if (status === 'PUBLISHED' && !publishedAt) publishedAt = new Date()
  if (status === 'PUBLISHED' && publishedAt && publishedAt > new Date()) {
    warnings.push('發布時間在未來，時間到了才會出現在前台')
  }

  await db.$transaction([
    db.post.update({
      where: { id: post.id },
      data: {
        title: parsed.title,
        slug,
        bodyHtml,
        status,
        publishedAt,
        ...(parsed.excerpt !== undefined ? { excerpt: parsed.excerpt || null } : {}),
        ...(parsed.tags !== undefined ? { tags: parsed.tags } : {}),
        ...(parsed.seoTitle !== undefined ? { seoTitle: parsed.seoTitle } : {}),
        ...(parsed.seoDescription !== undefined ? { seoDescription: parsed.seoDescription } : {}),
        ...(coverImageUrl !== undefined ? { coverImageUrl } : {}),
      },
    }),
    ...translations.map((t) =>
      db.postTranslation.upsert({
        where: { postId_locale: { postId: post.id, locale: t.locale } },
        create: { postId: post.id, locale: t.locale, title: t.title, excerpt: t.excerpt, bodyHtml: t.bodyHtml },
        update: { title: t.title, excerpt: t.excerpt, bodyHtml: t.bodyHtml },
      }),
    ),
  ])

  warnings.push(...missingEmbedWarning(await missingEmbeds(bodyHtml, ...translations.map((t) => t.bodyHtml))))

  await audit({
    userId,
    action: 'post.import',
    entity: 'Post',
    entityId: post.id,
    before: existing ? { slug: existing.slug, status: existing.status } : undefined,
    after: {
      created: !existing,
      title: parsed.title,
      slug,
      status,
      publishedAt,
      tags: parsed.tags,
      bodyLength: bodyHtml.length,
      imagesSaved: images.saved,
      translations: translations.map((t) => t.locale),
    },
  })

  revalidateJournal([post.slug, slug])

  return {
    postId: post.id,
    created: !existing,
    title: parsed.title,
    status,
    imagesSaved: images.saved,
    translations: translations.map((t) => t.locale),
    warnings,
  }
}
