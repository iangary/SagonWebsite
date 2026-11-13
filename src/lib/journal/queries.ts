import 'server-only'
import { cache } from 'react'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { defaultLocale } from '@/i18n/config'
import { plainTextExcerpt } from './html'

export const POSTS_PER_PAGE = 12

/** 譯文可以填的語系。zh-TW 是文章本身，不在這裡。 */
export const TRANSLATION_LOCALES = ['en', 'ja', 'ko', 'fr'] as const
export type TranslationLocale = (typeof TRANSLATION_LOCALES)[number]

/**
 * 前台看得到的文章：已發布，而且發布時間已到。
 * 發布時間填未來就是排程 —— 時間一到自然出現，不需要排程工作。
 *
 * `now` 由呼叫端傳入，同一個請求裡列表與總數才會用同一個時間點。
 */
export function publishedWhere(now: Date = new Date()): Prisma.PostWhereInput {
  return { status: 'PUBLISHED', publishedAt: { lte: now } }
}

const LIST_SELECT = {
  id: true,
  slug: true,
  title: true,
  excerpt: true,
  bodyHtml: true,
  coverImageUrl: true,
  tags: true,
  publishedAt: true,
  translations: { select: { locale: true, title: true, excerpt: true, bodyHtml: true } },
} satisfies Prisma.PostSelect

type ListRow = Prisma.PostGetPayload<{ select: typeof LIST_SELECT }>

/**
 * 依語系挑出要顯示的標題、摘要、內文。
 *
 * 只有「標題與內文都有填」的譯文才算數 —— 半套譯文（只翻了標題）配中文內文，
 * 比整篇中文更讓人困惑。沒有可用譯文就整篇顯示中文原文。
 */
export function localizePost(
  post: Pick<ListRow, 'title' | 'excerpt' | 'bodyHtml' | 'translations'>,
  locale: string,
): { title: string; excerpt: string; bodyHtml: string; locale: string } {
  if (locale !== defaultLocale) {
    const t = post.translations.find((tr) => tr.locale === locale)
    if (t && t.title.trim() && t.bodyHtml.trim()) {
      return {
        title: t.title,
        excerpt: t.excerpt?.trim() || plainTextExcerpt(t.bodyHtml),
        bodyHtml: t.bodyHtml,
        locale,
      }
    }
  }
  return {
    title: post.title,
    excerpt: post.excerpt?.trim() || plainTextExcerpt(post.bodyHtml),
    bodyHtml: post.bodyHtml,
    locale: defaultLocale,
  }
}

export type PostSummary = {
  id: string
  slug: string
  title: string
  excerpt: string
  coverImageUrl: string | null
  tags: string[]
  publishedAt: Date
}

function toSummary(row: ListRow, locale: string): PostSummary {
  const { title, excerpt } = localizePost(row, locale)
  return {
    id: row.id,
    slug: row.slug,
    title,
    excerpt,
    coverImageUrl: row.coverImageUrl,
    tags: row.tags,
    // publishedWhere 已經保證不是 null
    publishedAt: row.publishedAt!,
  }
}

export async function listPublishedPosts({
  locale,
  tag,
  page = 1,
  perPage = POSTS_PER_PAGE,
}: {
  locale: string
  tag?: string
  page?: number
  perPage?: number
}): Promise<{ posts: PostSummary[]; total: number; totalPages: number; page: number }> {
  const where: Prisma.PostWhereInput = {
    ...publishedWhere(),
    ...(tag ? { tags: { has: tag } } : {}),
  }
  const total = await db.post.count({ where })
  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const current = Math.min(Math.max(1, page), totalPages)

  const rows = await db.post.findMany({
    where,
    select: LIST_SELECT,
    orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
    skip: (current - 1) * perPage,
    take: perPage,
  })

  return { posts: rows.map((r) => toSummary(r, locale)), total, totalPages, page: current }
}

/** 已發布文章用到的所有標籤，依使用次數排序。列表頁上方的篩選用。 */
export async function listPublishedTags(): Promise<{ tag: string; count: number }[]> {
  const rows = await db.$queryRaw<{ tag: string; count: bigint }[]>`
    SELECT t AS tag, COUNT(*) AS count
      FROM posts, unnest(tags) AS t
     WHERE status = 'PUBLISHED' AND "publishedAt" <= now()
     GROUP BY t
     ORDER BY count DESC, t ASC
  `
  return rows.map((r) => ({ tag: r.tag, count: Number(r.count) }))
}

/** 文章內頁。請求內 cache，generateMetadata 與頁面本體共用一次查詢。 */
export const getPublishedPostBySlug = cache(async (slug: string) => {
  return db.post.findFirst({
    where: { slug, ...publishedWhere() },
    select: {
      ...LIST_SELECT,
      seoTitle: true,
      seoDescription: true,
      updatedAt: true,
    },
  })
})

export type PublishedPost = NonNullable<Awaited<ReturnType<typeof getPublishedPostBySlug>>>

/** 同標籤的其他文章，不夠就用最新文章補。 */
export async function getRelatedPosts(
  post: { id: string; tags: string[] },
  locale: string,
  take = 3,
): Promise<PostSummary[]> {
  const base = { ...publishedWhere(), id: { not: post.id } }
  const sameTag =
    post.tags.length > 0
      ? await db.post.findMany({
          where: { ...base, tags: { hasSome: post.tags } },
          select: LIST_SELECT,
          orderBy: { publishedAt: 'desc' },
          take,
        })
      : []

  const rest =
    sameTag.length < take
      ? await db.post.findMany({
          where: { ...base, id: { notIn: [post.id, ...sameTag.map((p) => p.id)] } },
          select: LIST_SELECT,
          orderBy: { publishedAt: 'desc' },
          take: take - sameTag.length,
        })
      : []

  return [...sameTag, ...rest].map((r) => toSummary(r, locale))
}
