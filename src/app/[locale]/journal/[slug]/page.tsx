import type { Metadata } from 'next'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/routing'
import { defaultLocale } from '@/i18n/config'
import { getPublishedPostBySlug, getRelatedPosts, localizePost } from '@/lib/journal/queries'
import { renderPostBody } from '@/lib/journal/render'
import { articleJsonLd, breadcrumbJsonLd, serializeJsonLd } from '@/lib/seo/structured-data'
import { truncate } from '@/lib/utils'
import { PostCard, formatPostDate } from '@/components/journal/post-card'

/** 動態渲染，理由同列表頁：排程發布，以及 [locale] 沒有 generateStaticParams。 */
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}): Promise<Metadata> {
  const { locale, slug } = await params
  const post = await getPublishedPostBySlug(decodeURIComponent(slug))
  if (!post) return {}

  const localized = localizePost(post, locale)
  // seoTitle / seoDescription 是中文原文用的；外語譯文直接用譯文標題與摘要
  const useSeoFields = localized.locale === defaultLocale
  const title = (useSeoFields && post.seoTitle) || localized.title
  const description = truncate((useSeoFields && post.seoDescription) || localized.excerpt, 155)
  const url = `/journal/${post.slug}`

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      title: localized.title,
      description,
      url,
      publishedTime: post.publishedAt!.toISOString(),
      modifiedTime: post.updatedAt.toISOString(),
      tags: post.tags,
      images: post.coverImageUrl ? [{ url: post.coverImageUrl }] : undefined,
    },
    twitter: {
      card: post.coverImageUrl ? 'summary_large_image' : 'summary',
      title: localized.title,
      description,
      images: post.coverImageUrl ? [post.coverImageUrl] : undefined,
    },
  }
}

export default async function JournalPostPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>
}) {
  const { locale, slug } = await params
  setRequestLocale(locale)

  const post = await getPublishedPostBySlug(decodeURIComponent(slug))
  if (!post) notFound()

  const [t, tNav] = await Promise.all([getTranslations('journal'), getTranslations('nav')])
  const localized = localizePost(post, locale)
  const [bodyHtml, related] = await Promise.all([
    renderPostBody(localized.bodyHtml, locale, { view: t('viewProduct'), soldOut: t('soldOut') }),
    getRelatedPosts(post, locale),
  ])
  const publishedAt = post.publishedAt!
  const showingOriginal = locale !== defaultLocale && localized.locale === defaultLocale

  const trail = [
    { name: tNav('home'), path: '/' },
    { name: t('title'), path: '/journal' },
    { name: localized.title, path: `/journal/${post.slug}` },
  ]
  const jsonLd = [
    articleJsonLd({
      locale,
      slug: post.slug,
      title: localized.title,
      description: localized.excerpt,
      image: post.coverImageUrl,
      publishedAt,
      updatedAt: post.updatedAt,
      tags: post.tags,
    }),
    breadcrumbJsonLd(trail),
  ]

  return (
    <>
      <script
        type="application/ld+json"
        // serializeJsonLd 會跳脫 <，標題裡的 </script> 關不掉這個標籤
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />

      <article className="mx-auto max-w-3xl px-6 py-10 sm:py-14">
        <nav aria-label={t('breadcrumb')}>
          <ol className="flex flex-wrap items-center gap-1.5 text-xs text-taupe-500">
            {trail.map((item, i) => (
              <li key={item.path} className="flex items-center gap-1.5">
                {i > 0 && <span aria-hidden>/</span>}
                {i < trail.length - 1 ? (
                  <Link href={item.path} className="hover:text-ink-900">
                    {item.name}
                  </Link>
                ) : (
                  <span className="line-clamp-1 text-ink-700">{item.name}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>

        <header className="mt-8 text-center" lang={localized.locale}>
          <p className="text-xs tracking-[0.15em] text-taupe-500">
            <time dateTime={publishedAt.toISOString()}>{formatPostDate(publishedAt, locale)}</time>
          </p>
          <h1 className="mt-4 text-2xl leading-snug tracking-[0.08em] text-ink-900 sm:text-3xl">
            {localized.title}
          </h1>
          {post.tags.length > 0 && (
            <ul className="mt-5 flex flex-wrap justify-center gap-2" aria-label={t('tags')}>
              {post.tags.map((tag) => (
                <li key={tag}>
                  <Link
                    href={{ pathname: '/journal', query: { tag } }}
                    className="inline-flex rounded-full border border-cream-300 px-3 py-1 text-xs text-ink-700 transition-colors hover:border-taupe-500"
                  >
                    #{tag}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </header>

        {post.coverImageUrl && (
          <div className="relative mt-10 aspect-[16/9] overflow-hidden rounded-[var(--radius-card)] bg-cream-100">
            <Image
              src={post.coverImageUrl}
              alt=""
              fill
              priority
              sizes="(min-width: 768px) 45rem, 100vw"
              className="object-cover"
            />
          </div>
        )}

        {showingOriginal && (
          <p className="mt-8 border-l-2 border-cream-300 pl-3 text-xs text-taupe-600">{t('originalOnly')}</p>
        )}

        <div
          lang={localized.locale}
          className="prose-product prose-journal mt-10"
          // renderPostBody 已經過允許清單消毒；商品卡片的每個欄位都跳脫過
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />

        <footer className="mt-16 border-t border-cream-200 pt-8 text-center">
          <Link
            href="/journal"
            className="text-sm tracking-[0.12em] text-taupe-600 underline-offset-4 hover:text-ink-900 hover:underline"
          >
            ← {t('backToList')}
          </Link>
        </footer>
      </article>

      {related.length > 0 && (
        <section className="mx-auto max-w-7xl border-t border-cream-200 px-6 py-14">
          <h2 className="text-center text-lg tracking-[0.12em]">{t('related')}</h2>
          <div className="mt-10 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((p) => (
              <PostCard key={p.id} post={p} locale={locale} readMore={t('readMore')} />
            ))}
          </div>
        </section>
      )}
    </>
  )
}
