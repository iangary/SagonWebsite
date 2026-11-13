import Image from 'next/image'
import { Link } from '@/i18n/routing'
import type { PostSummary } from '@/lib/journal/queries'

export function formatPostDate(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'Asia/Taipei' }).format(date)
}

export function PostCard({
  post,
  locale,
  readMore,
  priority = false,
}: {
  post: PostSummary
  locale: string
  readMore: string
  priority?: boolean
}) {
  return (
    <article className="group">
      <Link href={`/journal/${post.slug}`} className="block">
        <div className="relative aspect-[4/3] overflow-hidden bg-cream-100">
          {post.coverImageUrl ? (
            <Image
              src={post.coverImageUrl}
              alt=""
              fill
              sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
              priority={priority}
              className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full items-center justify-center font-display text-2xl tracking-[0.3em] text-cream-300">
              SAGAN
            </div>
          )}
        </div>
        <div className="pt-4">
          <p className="text-xs tracking-wide text-taupe-500">
            <time dateTime={post.publishedAt.toISOString()}>{formatPostDate(post.publishedAt, locale)}</time>
            {post.tags.length > 0 && <span className="ml-2">· {post.tags.slice(0, 3).map((t) => `#${t}`).join(' ')}</span>}
          </p>
          <h2 className="mt-2 text-base leading-relaxed tracking-[0.04em] text-ink-900 transition-colors group-hover:text-taupe-600">
            {post.title}
          </h2>
          {post.excerpt && <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-ink-700">{post.excerpt}</p>}
          <p className="mt-3 text-xs tracking-[0.12em] text-taupe-600 underline-offset-4 group-hover:underline">
            {readMore} →
          </p>
        </div>
      </Link>
    </article>
  )
}
