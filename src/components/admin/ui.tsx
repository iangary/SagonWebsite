import Link from 'next/link'
import { cn } from '@/lib/utils'

/** 後台共用的版面元件，避免每個頁面重寫一次表格與卡片樣式。 */

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-cream-200 pb-5">
      <div>
        <h1 className="text-xl tracking-[0.1em]">{title}</h1>
        {description && <p className="mt-1.5 text-sm text-taupe-600">{description}</p>}
      </div>
      {action}
    </header>
  )
}

export function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string | number
  hint?: string
  tone?: 'alert'
}) {
  return (
    <div className="border border-cream-200 bg-white p-5">
      <p className="text-xs tracking-wide text-taupe-600">{label}</p>
      <p
        className={cn(
          'mt-2 text-2xl tabular-nums',
          tone === 'alert' ? 'text-sale' : 'text-ink-900',
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-taupe-500">{hint}</p>}
    </div>
  )
}

export function DataTable({
  headers,
  children,
  empty,
}: {
  headers: string[]
  children: React.ReactNode
  empty?: boolean
}) {
  return (
    <div className="overflow-x-auto border border-cream-200 bg-white">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-cream-200 bg-cream-100 text-left">
            {headers.map((header) => (
              <th
                key={header}
                className="whitespace-nowrap px-4 py-3 text-xs font-medium tracking-wide text-taupe-600"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-cream-100">
          {empty ? (
            <tr>
              <td colSpan={headers.length} className="px-4 py-16 text-center text-taupe-500">
                沒有資料
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  )
}

export function Td({
  children,
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn('px-4 py-3 align-middle', className)} {...props}>
      {children}
    </td>
  )
}

/** 後台列表的分頁，維持 searchParams 只換 page */
export function AdminPagination({
  page,
  totalPages,
  basePath,
  searchParams,
}: {
  page: number
  totalPages: number
  basePath: string
  searchParams: Record<string, string | undefined>
}) {
  if (totalPages <= 1) return null

  function hrefFor(target: number) {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(searchParams)) {
      if (key !== 'page' && value) params.set(key, value)
    }
    if (target > 1) params.set('page', String(target))
    const qs = params.toString()
    return qs ? `${basePath}?${qs}` : basePath
  }

  return (
    <div className="mt-6 flex items-center justify-between text-sm">
      <p className="text-taupe-600">
        第 {page} / {totalPages} 頁
      </p>
      <div className="flex gap-2">
        {page > 1 && (
          <Link
            href={hrefFor(page - 1)}
            className="border border-cream-300 px-3 py-1.5 text-ink-700 hover:bg-cream-100"
          >
            上一頁
          </Link>
        )}
        {page < totalPages && (
          <Link
            href={hrefFor(page + 1)}
            className="border border-cream-300 px-3 py-1.5 text-ink-700 hover:bg-cream-100"
          >
            下一頁
          </Link>
        )}
      </div>
    </div>
  )
}
