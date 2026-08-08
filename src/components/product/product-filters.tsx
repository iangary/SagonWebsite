'use client'

import * as React from 'react'
import { useRouter, usePathname } from '@/i18n/routing'
import { useSearchParams } from 'next/navigation'
import { X } from 'lucide-react'
import { Select } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type BrandOption = { slug: string; name: string; count: number }

const SORT_OPTIONS = [
  { value: 'newest', labelKey: 'sortNewest' },
  { value: 'price-asc', labelKey: 'sortPriceAsc' },
  { value: 'price-desc', labelKey: 'sortPriceDesc' },
  { value: 'name-asc', labelKey: 'sortNameAsc' },
] as const

const PRICE_BANDS = [
  { label: '1,000 以下', min: undefined, max: 999 },
  { label: '1,000 – 2,000', min: 1000, max: 2000 },
  { label: '2,000 – 3,000', min: 2000, max: 3000 },
  { label: '3,000 以上', min: 3000, max: undefined },
]

export function ProductFilters({
  brands,
  labels,
  showBrandFilter = true,
}: {
  brands: BrandOption[]
  labels: Record<string, string>
  showBrandFilter?: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const selectedBrands = searchParams.getAll('brand')
  const currentSort = searchParams.get('sort') ?? 'newest'
  const currentMin = searchParams.get('minPrice')
  const currentMax = searchParams.get('maxPrice')
  const query = searchParams.get('q')

  /** 改任何篩選都回到第 1 頁，否則會停在一個超出範圍的分頁上 */
  const apply = React.useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString())
      mutate(params)
      params.delete('page')
      const qs = params.toString()
      router.push(qs ? `${pathname}?${qs}` : pathname)
    },
    [router, pathname, searchParams],
  )

  function toggleBrand(slug: string) {
    apply((params) => {
      const current = params.getAll('brand')
      params.delete('brand')
      const next = current.includes(slug)
        ? current.filter((b) => b !== slug)
        : [...current, slug]
      for (const b of next) params.append('brand', b)
    })
  }

  function setPriceBand(band: (typeof PRICE_BANDS)[number] | null) {
    apply((params) => {
      params.delete('minPrice')
      params.delete('maxPrice')
      if (!band) return
      if (band.min !== undefined) params.set('minPrice', String(band.min))
      if (band.max !== undefined) params.set('maxPrice', String(band.max))
    })
  }

  function isBandActive(band: (typeof PRICE_BANDS)[number]) {
    return (
      (band.min?.toString() ?? null) === currentMin && (band.max?.toString() ?? null) === currentMax
    )
  }

  const hasFilters = selectedBrands.length > 0 || currentMin || currentMax || query

  return (
    <div className="space-y-8">
      <div>
        <label htmlFor="sort" className="mb-2 block text-xs tracking-wide text-taupe-600">
          {labels.sortBy}
        </label>
        <Select
          id="sort"
          value={currentSort}
          onChange={(e) => apply((p) => p.set('sort', e.target.value))}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {labels[o.labelKey]}
            </option>
          ))}
        </Select>
      </div>

      {showBrandFilter && brands.length > 0 && (
        <fieldset>
          <legend className="mb-3 text-xs tracking-wide text-taupe-600">
            {labels.filterBrand}
          </legend>
          <ul className="space-y-2">
            {brands.map((brand) => {
              const checked = selectedBrands.includes(brand.slug)
              return (
                <li key={brand.slug}>
                  <label className="flex cursor-pointer items-center gap-2.5 text-sm text-ink-700">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleBrand(brand.slug)}
                      className="size-3.5 accent-[#2b2724]"
                    />
                    <span className={cn(checked && 'text-ink-900')}>{brand.name}</span>
                    <span className="text-xs text-taupe-400">({brand.count})</span>
                  </label>
                </li>
              )
            })}
          </ul>
        </fieldset>
      )}

      <fieldset>
        <legend className="mb-3 text-xs tracking-wide text-taupe-600">{labels.filterPrice}</legend>
        <ul className="space-y-2">
          {PRICE_BANDS.map((band) => {
            const active = isBandActive(band)
            return (
              <li key={band.label}>
                <button
                  onClick={() => setPriceBand(active ? null : band)}
                  className={cn(
                    'text-sm transition-colors',
                    active ? 'text-ink-900 underline underline-offset-4' : 'text-ink-700 hover:text-taupe-600',
                  )}
                >
                  NT${band.label}
                </button>
              </li>
            )
          })}
        </ul>
      </fieldset>

      {hasFilters && (
        <button
          onClick={() => router.push(pathname)}
          className="flex items-center gap-1.5 text-xs text-taupe-600 underline underline-offset-4 hover:text-ink-900"
        >
          <X size={13} />
          {labels.clearFilters}
        </button>
      )}
    </div>
  )
}
