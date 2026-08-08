import { getTranslations } from 'next-intl/server'
import { ProductGrid } from './product-card'
import { ProductFilters } from './product-filters'
import { Pagination } from './pagination'
import { listBrands, listProducts, parseSort, type ProductListFilters } from '@/lib/catalog/queries'

export type ListingSearchParams = {
  q?: string
  brand?: string | string[]
  sort?: string
  minPrice?: string
  maxPrice?: string
  page?: string
}

function toNumber(value: string | undefined): number | undefined {
  if (!value) return undefined
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

export function parseListingParams(
  searchParams: ListingSearchParams,
  categorySlug?: string,
): ProductListFilters {
  const brand = searchParams.brand
  return {
    q: searchParams.q?.trim() || undefined,
    brandSlugs: brand ? (Array.isArray(brand) ? brand : [brand]) : undefined,
    categorySlug,
    minPrice: toNumber(searchParams.minPrice),
    maxPrice: toNumber(searchParams.maxPrice),
    sort: parseSort(searchParams.sort),
    page: toNumber(searchParams.page) ?? 1,
  }
}

/**
 * /product/all 與 /category/[slug] 共用的列表版面。
 * 分類頁不顯示品牌篩選（分類本身就已經對應到品牌）。
 */
export async function ProductListing({
  title,
  description,
  basePath,
  searchParams,
  categorySlug,
  showBrandFilter = true,
}: {
  title: string
  description?: string | null
  basePath: string
  searchParams: ListingSearchParams
  categorySlug?: string
  showBrandFilter?: boolean
}) {
  const filters = parseListingParams(searchParams, categorySlug)
  const [t, result, brands] = await Promise.all([
    getTranslations('list'),
    listProducts(filters),
    listBrands(),
  ])

  const labels = {
    sortBy: t('sortBy'),
    sortNewest: t('sortNewest'),
    sortPriceAsc: t('sortPriceAsc'),
    sortPriceDesc: t('sortPriceDesc'),
    sortNameAsc: t('sortNameAsc'),
    filterBrand: t('filterBrand'),
    filterPrice: t('filterPrice'),
    clearFilters: t('clearFilters'),
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
      <header className="border-b border-cream-200 pb-6">
        <h1 className="text-2xl tracking-[0.12em]">{title}</h1>
        {description && <p className="mt-3 max-w-2xl text-sm text-ink-700">{description}</p>}
        {filters.q && (
          <p className="mt-3 text-sm text-taupe-600">
            「{filters.q}」的搜尋結果
          </p>
        )}
        <p className="mt-3 text-xs text-taupe-500">{t('resultCount', { count: result.total })}</p>
      </header>

      <div className="mt-10 gap-12 lg:flex">
        <aside className="mb-10 shrink-0 lg:mb-0 lg:w-52">
          <ProductFilters
            brands={brands.map((b) => ({
              slug: b.slug,
              name: b.name,
              count: b._count.products,
            }))}
            labels={labels}
            showBrandFilter={showBrandFilter}
          />
        </aside>

        <div className="flex-1">
          {result.items.length === 0 ? (
            <p className="py-24 text-center text-sm text-taupe-500">{t('empty')}</p>
          ) : (
            <>
              <ProductGrid products={result.items} />
              <Pagination
                page={result.page}
                totalPages={result.totalPages}
                basePath={basePath}
                searchParams={searchParams as Record<string, string | string[] | undefined>}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
