import { useTranslations } from 'next-intl'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Link } from '@/i18n/routing'
import { cn } from '@/lib/utils'

/**
 * 產生要顯示的頁碼，中間過多時用 '…' 收合。
 * 例如 page=7, total=20 → [1, '…', 6, 7, 8, '…', 20]
 */
export function buildPageItems(page: number, totalPages: number): (number | '…')[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)

  const items: (number | '…')[] = [1]
  const start = Math.max(2, page - 1)
  const end = Math.min(totalPages - 1, page + 1)

  if (start > 2) items.push('…')
  for (let i = start; i <= end; i++) items.push(i)
  if (end < totalPages - 1) items.push('…')
  items.push(totalPages)

  return items
}

export function Pagination({
  page,
  totalPages,
  basePath,
  searchParams,
}: {
  page: number
  totalPages: number
  basePath: string
  searchParams: Record<string, string | string[] | undefined>
}) {
  const t = useTranslations('list')

  if (totalPages <= 1) return null

  function hrefFor(target: number) {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(searchParams)) {
      if (key === 'page' || value === undefined) continue
      if (Array.isArray(value)) value.forEach((v) => params.append(key, v))
      else params.set(key, value)
    }
    if (target > 1) params.set('page', String(target))
    const qs = params.toString()
    return qs ? `${basePath}?${qs}` : basePath
  }

  const items = buildPageItems(page, totalPages)

  return (
    <nav
      aria-label={t('paginationLabel')}
      className="mt-14 flex items-center justify-center gap-1"
    >
      {page > 1 ? (
        <Link
          href={hrefFor(page - 1)}
          aria-label={t('prevPage')}
          className="flex size-9 items-center justify-center text-ink-700 hover:bg-cream-100"
        >
          <ChevronLeft size={16} />
        </Link>
      ) : (
        <span className="flex size-9 items-center justify-center text-taupe-300">
          <ChevronLeft size={16} />
        </span>
      )}

      {items.map((item, i) =>
        item === '…' ? (
          <span key={`gap-${i}`} className="px-1 text-xs text-taupe-400">
            …
          </span>
        ) : (
          <Link
            key={item}
            href={hrefFor(item)}
            aria-current={item === page ? 'page' : undefined}
            className={cn(
              'flex size-9 items-center justify-center text-sm transition-colors',
              item === page
                ? 'bg-ink-900 text-cream-50'
                : 'text-ink-700 hover:bg-cream-100',
            )}
          >
            {item}
          </Link>
        ),
      )}

      {page < totalPages ? (
        <Link
          href={hrefFor(page + 1)}
          aria-label={t('nextPage')}
          className="flex size-9 items-center justify-center text-ink-700 hover:bg-cream-100"
        >
          <ChevronRight size={16} />
        </Link>
      ) : (
        <span className="flex size-9 items-center justify-center text-taupe-300">
          <ChevronRight size={16} />
        </span>
      )}
    </nav>
  )
}
