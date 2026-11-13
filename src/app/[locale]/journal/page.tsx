import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/routing'
import { cn } from '@/lib/utils'
import { listPublishedPosts, listPublishedTags } from '@/lib/journal/queries'
import { PostCard } from '@/components/journal/post-card'
import { Pagination } from '@/components/product/pagination'

/**
 * 專欄列表。動態渲染：文章可以排程發布，時間一到就該出現，
 * 而且 [locale] 沒有 generateStaticParams（見 product/[slug]/page.tsx 的說明）。
 */
export const dynamic = 'force-dynamic'

type SearchParams = { tag?: string; page?: string }

function readTag(sp: SearchParams): string | undefined {
  const tag = sp.tag?.trim()
  return tag ? tag.slice(0, 40) : undefined
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<SearchParams>
}): Promise<Metadata> {
  const { locale } = await params
  const sp = await searchParams
  const tag = readTag(sp)
  const t = await getTranslations({ locale, namespace: 'journal' })

  const title = tag ? `${t('tagTitle', { tag })} | ${t('title')}` : t('title')
  const canonical = tag ? `/journal?tag=${encodeURIComponent(tag)}` : '/journal'

  return {
    title,
    description: t('description'),
    alternates: { canonical },
    openGraph: { type: 'website', title, description: t('description'), url: canonical },
  }
}

export default async function JournalPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<SearchParams>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const sp = await searchParams
  const tag = readTag(sp)
  const page = Number.parseInt(sp.page ?? '1', 10) || 1

  const [t, result, tags] = await Promise.all([
    getTranslations('journal'),
    listPublishedPosts({ locale, tag, page }),
    listPublishedTags(),
  ])

  const chip = (active: boolean) =>
    cn(
      'inline-flex min-h-9 items-center rounded-full border px-4 text-xs tracking-wide transition-colors',
      active
        ? 'border-ink-900 bg-ink-900 text-cream-50'
        : 'border-cream-300 text-ink-700 hover:border-taupe-500',
    )

  return (
    <div className="mx-auto max-w-7xl px-6 py-12 sm:py-16">
      <header className="mx-auto max-w-2xl text-center">
        <p className="font-display text-sm tracking-[0.3em] text-taupe-500 uppercase italic">Journal</p>
        <h1 className="mt-3 text-2xl tracking-[0.12em] sm:text-3xl">{t('title')}</h1>
        <p className="mt-4 text-sm leading-relaxed text-ink-700">{t('description')}</p>
      </header>

      {tags.length > 0 && (
        <nav aria-label={t('tags')} className="mt-10">
          <ul className="flex flex-wrap justify-center gap-2">
            <li>
              <Link href="/journal" className={chip(!tag)} aria-current={!tag ? 'page' : undefined}>
                {t('allTags')}
              </Link>
            </li>
            {tags.map(({ tag: name }) => (
              <li key={name}>
                <Link
                  href={{ pathname: '/journal', query: { tag: name } }}
                  className={chip(tag === name)}
                  aria-current={tag === name ? 'page' : undefined}
                >
                  #{name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {result.posts.length === 0 ? (
        <p className="mt-16 text-center text-sm text-taupe-500">{tag ? t('emptyTag') : t('empty')}</p>
      ) : (
        <div className="mt-12 grid gap-x-8 gap-y-14 sm:grid-cols-2 lg:grid-cols-3">
          {result.posts.map((post, i) => (
            <PostCard key={post.id} post={post} locale={locale} readMore={t('readMore')} priority={i < 3} />
          ))}
        </div>
      )}

      <div className="mt-14">
        <Pagination
          page={result.page}
          totalPages={result.totalPages}
          basePath="/journal"
          searchParams={{ tag }}
        />
      </div>
    </div>
  )
}
