import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { db } from '@/lib/db'
import { Badge } from '@/components/ui/badge'
import { toTaipeiDateTimeInput } from '@/lib/journal/form'
import { TRANSLATION_LOCALES } from '@/lib/journal/queries'
import { postStatusLabel } from '../status'
import { PostEditor } from './post-editor'
import { TranslationEditor } from './translation-editor'
import { DeletePost } from './delete-post'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const post = await db.post.findUnique({ where: { id }, select: { title: true } })
  return { title: post?.title ?? '文章' }
}

export default async function AdminPostDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const post = await db.post.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      slug: true,
      excerpt: true,
      bodyHtml: true,
      coverImageUrl: true,
      tags: true,
      status: true,
      publishedAt: true,
      seoTitle: true,
      seoDescription: true,
      translations: { select: { locale: true, title: true, excerpt: true, bodyHtml: true } },
    },
  })
  if (!post) notFound()

  const label = postStatusLabel(post.status, post.publishedAt, new Date())
  const visible = label.text === '已發布'

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <Link
          href="/admin/journal"
          className="inline-flex items-center gap-1.5 text-sm text-taupe-600 hover:text-ink-900"
        >
          <ArrowLeft size={14} />
          回文章列表
        </Link>
        {visible && (
          <a
            href={`/journal/${encodeURIComponent(post.slug)}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-taupe-600 hover:text-ink-900"
          >
            在前台檢視
            <ExternalLink size={13} />
          </a>
        )}
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-xl tracking-[0.1em]">{post.title}</h1>
        <Badge tone={label.tone}>{label.text}</Badge>
      </div>

      <div className="space-y-6">
        <PostEditor
          post={{
            id: post.id,
            title: post.title,
            slug: post.slug,
            excerpt: post.excerpt ?? '',
            bodyHtml: post.bodyHtml,
            coverImageUrl: post.coverImageUrl ?? '',
            tags: post.tags.join('、'),
            status: post.status,
            publishedAt: toTaipeiDateTimeInput(post.publishedAt),
            seoTitle: post.seoTitle ?? '',
            seoDescription: post.seoDescription ?? '',
          }}
        />

        <TranslationEditor
          postId={post.id}
          translations={TRANSLATION_LOCALES.map((locale) => {
            const t = post.translations.find((tr) => tr.locale === locale)
            return {
              locale,
              title: t?.title ?? '',
              excerpt: t?.excerpt ?? '',
              bodyHtml: t?.bodyHtml ?? '',
            }
          })}
        />

        <DeletePost postId={post.id} title={post.title} />
      </div>
    </>
  )
}
