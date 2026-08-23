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
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-cream-200 pb-4 sm:mb-8 sm:pb-5">
      <div className="min-w-0">
        <h1 className="text-lg tracking-[0.1em] sm:text-xl">{title}</h1>
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
    <div className="border border-cream-200 bg-white p-4 sm:p-5">
      <p className="text-xs tracking-wide text-taupe-600">{label}</p>
      <p
        className={cn(
          'mt-2 text-xl tabular-nums sm:text-2xl',
          tone === 'alert' ? 'text-sale' : 'text-ink-900',
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-taupe-500">{hint}</p>}
    </div>
  )
}

/**
 * 列表用的表格。
 *
 * 手機上會變成「一列一張卡」（規則在 globals.css 的 .admin-table），
 * 每格左邊補上欄位名稱 —— 名稱不重寫一份，這裡把 headers 寫成 --col-1…--col-N
 * 交給 CSS 的 ::before 讀。改表頭文字或順序，卡片上的標籤會自動跟著變。
 * 上限 10 欄，超過的欄位在手機上就沒有標籤（globals.css 只列到 --col-10）。
 */
export function DataTable({
  headers,
  children,
  empty,
}: {
  headers: string[]
  children: React.ReactNode
  empty?: boolean
}) {
  const columnLabels = Object.fromEntries(
    headers.map((header, index) => [
      `--col-${index + 1}`,
      // CSS 的 content 要的是帶引號的字串，反斜線與引號得先脫逸
      `"${header.replace(/[\\"]/g, '\$&')}"`,
    ]),
  ) as React.CSSProperties

  return (
    <div className="overflow-x-auto border border-cream-200 bg-white">
      <table style={columnLabels} className="admin-table w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-cream-200 bg-cream-100 text-left">
            {headers.map((header, index) => (
              <th
                key={`${header}-${index}`}
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

/**
 * 列表上方的快篩鈕。
 *
 * href 由各頁自己算（要保留哪些 searchParams 每頁不同），這裡只管樣式與觸控尺寸 ——
 * 手機上一律 40px 高，用拇指點得到。
 */
export function FilterChips({
  label,
  items,
  active,
}: {
  label?: string
  items: { value: string; label: string; href: string }[]
  active: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {label && <span className="text-xs text-taupe-500">{label}</span>}
      {items.map((item) => (
        <Link
          key={item.value || 'all'}
          href={item.href}
          aria-current={active === item.value ? 'page' : undefined}
          className={cn(
            'inline-flex min-h-10 items-center border px-3 text-xs transition-colors sm:min-h-8',
            active === item.value
              ? 'border-ink-900 bg-ink-900 text-cream-50'
              : 'border-cream-300 text-ink-700 hover:border-taupe-400',
          )}
        >
          {item.label}
        </Link>
      ))}
    </div>
  )
}

/** 列表上方的搜尋框。手機上輸入框吃滿整行，桌機才收成固定寬。 */
export function SearchForm({
  name = 'q',
  defaultValue,
  placeholder,
  width = 'sm:w-72',
  hidden,
  className,
}: {
  name?: string
  defaultValue?: string
  placeholder: string
  /** 桌機的輸入框寬度 */
  width?: string
  /** 要一起帶上的其他 searchParams，不帶會在搜尋時被清掉 */
  hidden?: Record<string, string | undefined>
  className?: string
}) {
  return (
    <form method="get" className={cn('flex gap-2', className)}>
      {Object.entries(hidden ?? {}).map(([key, value]) =>
        value ? <input key={key} type="hidden" name={key} value={value} /> : null,
      )}
      <input
        name={name}
        defaultValue={defaultValue ?? ''}
        placeholder={placeholder}
        className={cn(
          'min-h-11 w-full border border-cream-300 bg-white px-3 text-sm focus:border-taupe-500 focus:outline-none sm:min-h-10',
          width,
        )}
      />
      <button
        type="submit"
        className="min-h-11 shrink-0 border border-ink-900 px-4 text-sm text-ink-900 transition-colors hover:bg-ink-900 hover:text-cream-50 sm:min-h-10"
      >
        搜尋
      </button>
    </form>
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
    <div className="mt-6 flex items-center justify-between gap-3 text-sm">
      <p className="text-taupe-600">
        第 {page} / {totalPages} 頁
      </p>
      <div className="flex gap-2">
        {page > 1 && (
          <Link
            href={hrefFor(page - 1)}
            className="inline-flex min-h-11 items-center border border-cream-300 px-4 text-ink-700 hover:bg-cream-100 sm:min-h-9 sm:px-3"
          >
            上一頁
          </Link>
        )}
        {page < totalPages && (
          <Link
            href={hrefFor(page + 1)}
            className="inline-flex min-h-11 items-center border border-cream-300 px-4 text-ink-700 hover:bg-cream-100 sm:min-h-9 sm:px-3"
          >
            下一頁
          </Link>
        )}
      </div>
    </div>
  )
}
