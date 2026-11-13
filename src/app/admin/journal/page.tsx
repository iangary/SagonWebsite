import Link from 'next/link'
import type { Prisma } from '@prisma/client'
import { Plus } from 'lucide-react'
import { db } from '@/lib/db'
import { PageHeader, DataTable, Td, FilterChips, SearchForm, AdminPagination } from '@/components/admin/ui'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { postStatusLabel } from './status'

export const dynamic = 'force-dynamic'
export const metadata = { title: '專欄文章' }

const PER_PAGE = 30

const STATUS_FILTERS = [
  { value: '', label: '全部' },
  { value: 'PUBLISHED', label: '已發布' },
  { value: 'DRAFT', label: '草稿' },
] as const

export default async function AdminJournalPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>
}) {
  const sp = await searchParams
  const status = sp.status === 'PUBLISHED' || sp.status === 'DRAFT' ? sp.status : ''
  const q = sp.q?.trim() ?? ''

  const where: Prisma.PostWhereInput = {}
  if (status) where.status = status
  if (q) {
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { slug: { contains: q, mode: 'insensitive' } },
      { tags: { has: q } },
    ]
  }

  const total = await db.post.count({ where })
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))
  const page = Math.min(Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1), totalPages)

  const posts = await db.post.findMany({
    where,
    orderBy: [{ updatedAt: 'desc' }],
    skip: (page - 1) * PER_PAGE,
    take: PER_PAGE,
    select: {
      id: true,
      title: true,
      slug: true,
      status: true,
      publishedAt: true,
      tags: true,
      updatedAt: true,
      translations: { select: { locale: true } },
    },
  })

  const now = new Date()
  const hrefFor = (value: string) => {
    const params = new URLSearchParams()
    if (value) params.set('status', value)
    if (q) params.set('q', q)
    const qs = params.toString()
    return qs ? `/admin/journal?${qs}` : '/admin/journal'
  }

  return (
    <>
      <PageHeader
        title="專欄文章"
        description={`共 ${total} 篇。發布後會出現在前台「專欄」，未發布的草稿只有後台看得到。`}
        action={
          <Button asChild size="sm">
            <Link href="/admin/journal/new">
              <Plus size={15} />
              新增文章
            </Link>
          </Button>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <FilterChips
          items={STATUS_FILTERS.map((f) => ({ ...f, href: hrefFor(f.value) }))}
          active={status}
        />
        <SearchForm
          placeholder="搜尋標題、網址代稱或標籤"
          defaultValue={q}
          hidden={{ status: status || undefined }}
        />
      </div>

      <DataTable headers={['標題', '狀態', '發布時間', '標籤', '譯文', '最後更新']} empty={posts.length === 0}>
        {posts.map((post) => {
          const label = postStatusLabel(post.status, post.publishedAt, now)
          return (
            <tr key={post.id}>
              <Td>
                <Link href={`/admin/journal/${post.id}`} className="text-ink-900 hover:underline">
                  {post.title}
                </Link>
                <div className="text-xs text-taupe-500">/journal/{post.slug}</div>
              </Td>
              <Td>
                <Badge tone={label.tone}>{label.text}</Badge>
              </Td>
              <Td className="whitespace-nowrap text-xs text-taupe-600 tabular-nums">
                {post.publishedAt
                  ? post.publishedAt.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })
                  : '—'}
              </Td>
              <Td className="text-xs text-taupe-600">{post.tags.join('、') || '—'}</Td>
              <Td className="text-xs uppercase text-taupe-600">
                {post.translations.map((t) => t.locale).join(' ') || '—'}
              </Td>
              <Td className="whitespace-nowrap text-xs text-taupe-500 tabular-nums">
                {post.updatedAt.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })}
              </Td>
            </tr>
          )
        })}
      </DataTable>

      <AdminPagination
        page={page}
        totalPages={totalPages}
        basePath="/admin/journal"
        searchParams={{ status: status || undefined, q: q || undefined }}
      />
    </>
  )
}
