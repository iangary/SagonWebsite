import Link from 'next/link'
import type { Prisma, ReviewStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { cn } from '@/lib/utils'
import { PageHeader, DataTable, Td, AdminPagination } from '@/components/admin/ui'
import { Badge } from '@/components/ui/badge'
import { Stars } from '@/components/product/product-reviews'
import { ReviewModeration } from './review-moderation'

export const dynamic = 'force-dynamic'
export const metadata = { title: '評論' }

const PER_PAGE = 30

const STATUS_LABEL: Record<ReviewStatus, string> = {
  PENDING: '待審核',
  APPROVED: '已通過',
  REJECTED: '已退回',
}

export default async function AdminReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>
}) {
  const sp = await searchParams
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1)

  const where: Prisma.ReviewWhereInput = {}
  if (sp.status && sp.status in STATUS_LABEL) where.status = sp.status as ReviewStatus

  const [reviews, total, pendingCount] = await Promise.all([
    db.review.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: {
        product: { select: { name: true, slug: true } },
        user: { select: { name: true, email: true } },
      },
    }),
    db.review.count({ where }),
    db.review.count({ where: { status: 'PENDING' } }),
  ])

  return (
    <>
      <PageHeader
        title="商品評論"
        description={pendingCount > 0 ? `${pendingCount} 則待審核` : '沒有待審核的評論'}
      />

      <div className="mb-5 flex gap-2">
        {[{ value: '', label: '全部' }, ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))].map(
          (filter) => (
            <Link
              key={filter.value || 'all'}
              href={filter.value ? `/admin/reviews?status=${filter.value}` : '/admin/reviews'}
              className={cn(
                'border px-3 py-1.5 text-xs transition-colors',
                (sp.status ?? '') === filter.value
                  ? 'border-ink-900 bg-ink-900 text-cream-50'
                  : 'border-cream-300 text-ink-700 hover:border-taupe-400',
              )}
            >
              {filter.label}
            </Link>
          ),
        )}
      </div>

      <DataTable
        headers={['商品', '評分', '內容', '會員', '狀態', '時間', '']}
        empty={reviews.length === 0}
      >
        {reviews.map((review) => (
          <tr key={review.id}>
            <Td className="max-w-48">
              <Link
                href={`/product/${review.product.slug}`}
                target="_blank"
                className="line-clamp-2 text-ink-900 underline underline-offset-4"
              >
                {review.product.name}
              </Link>
            </Td>
            <Td>
              <Stars rating={review.rating} size={13} />
            </Td>
            <Td className="max-w-72">
              {review.title && <div className="text-ink-900">{review.title}</div>}
              <div className="line-clamp-3 text-xs text-taupe-600">{review.body}</div>
            </Td>
            <Td className="text-xs text-taupe-600">
              {review.user.name ?? review.user.email ?? '—'}
            </Td>
            <Td>
              <Badge
                tone={
                  review.status === 'APPROVED'
                    ? 'success'
                    : review.status === 'REJECTED'
                      ? 'sale'
                      : 'warning'
                }
              >
                {STATUS_LABEL[review.status]}
              </Badge>
            </Td>
            <Td className="whitespace-nowrap text-xs text-taupe-500">
              {review.createdAt.toLocaleDateString('zh-TW')}
            </Td>
            <Td>
              <ReviewModeration reviewId={review.id} status={review.status} />
            </Td>
          </tr>
        ))}
      </DataTable>

      <AdminPagination
        page={page}
        totalPages={Math.max(1, Math.ceil(total / PER_PAGE))}
        basePath="/admin/reviews"
        searchParams={sp}
      />
    </>
  )
}
