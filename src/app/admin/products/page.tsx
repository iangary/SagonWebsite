import Link from 'next/link'
import Image from 'next/image'
import type { Prisma, ProductStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { formatTWD, cn } from '@/lib/utils'
import { PageHeader, DataTable, Td, AdminPagination } from '@/components/admin/ui'
import { Badge } from '@/components/ui/badge'

export const dynamic = 'force-dynamic'
export const metadata = { title: '商品' }

const PER_PAGE = 30
const LOW_STOCK_THRESHOLD = 3

const STATUS_LABEL: Record<ProductStatus, string> = {
  DRAFT: '草稿',
  ACTIVE: '上架中',
  ARCHIVED: '已封存',
}

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>
}) {
  const sp = await searchParams
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1)

  const where: Prisma.ProductWhereInput = {}
  if (sp.status && sp.status in STATUS_LABEL) where.status = sp.status as ProductStatus
  if (sp.q?.trim()) {
    where.OR = [
      { name: { contains: sp.q.trim(), mode: 'insensitive' } },
      { variants: { some: { sku: { contains: sp.q.trim(), mode: 'insensitive' } } } },
    ]
  }

  const [products, total] = await Promise.all([
    db.product.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      include: {
        brand: { select: { name: true } },
        images: { select: { url: true }, orderBy: { sortOrder: 'asc' }, take: 1 },
        variants: { select: { stock: true, reservedStock: true, isActive: true } },
      },
    }),
    db.product.count({ where }),
  ])

  return (
    <>
      <PageHeader title="商品" description={`共 ${total} 件`} />

      <div className="mb-5 flex flex-wrap gap-3">
        <form method="get" className="flex gap-2">
          <input
            name="q"
            defaultValue={sp.q ?? ''}
            placeholder="搜尋商品名稱或 SKU"
            className="w-64 border border-cream-300 bg-white px-3 py-2 text-sm focus:border-taupe-500 focus:outline-none"
          />
          <button
            type="submit"
            className="border border-ink-900 px-4 py-2 text-sm transition-colors hover:bg-ink-900 hover:text-cream-50"
          >
            搜尋
          </button>
        </form>

        <div className="flex gap-2">
          {[{ value: '', label: '全部' }, ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))].map(
            (filter) => {
              const params = new URLSearchParams()
              if (filter.value) params.set('status', filter.value)
              if (sp.q) params.set('q', sp.q)
              const qs = params.toString()
              return (
                <Link
                  key={filter.value || 'all'}
                  href={qs ? `/admin/products?${qs}` : '/admin/products'}
                  className={cn(
                    'border px-3 py-2 text-xs transition-colors',
                    (sp.status ?? '') === filter.value
                      ? 'border-ink-900 bg-ink-900 text-cream-50'
                      : 'border-cream-300 text-ink-700 hover:border-taupe-400',
                  )}
                >
                  {filter.label}
                </Link>
              )
            },
          )}
        </div>
      </div>

      <DataTable
        headers={['', '商品', '品牌', '售價', '規格 / 庫存', '狀態']}
        empty={products.length === 0}
      >
        {products.map((product) => {
          const totalStock = product.variants.reduce((s, v) => s + v.stock, 0)
          const reserved = product.variants.reduce((s, v) => s + v.reservedStock, 0)
          const low = totalStock <= LOW_STOCK_THRESHOLD

          return (
            <tr key={product.id} className="hover:bg-cream-50">
              <Td className="w-14">
                <div className="relative size-11 overflow-hidden bg-cream-100">
                  {product.images[0] && (
                    <Image
                      src={product.images[0].url}
                      alt=""
                      fill
                      sizes="44px"
                      className="object-cover"
                    />
                  )}
                </div>
              </Td>
              <Td>
                <Link
                  href={`/admin/products/${product.id}`}
                  className="text-ink-900 underline underline-offset-4"
                >
                  {product.name}
                </Link>
              </Td>
              <Td className="text-taupe-600">{product.brand?.name ?? '—'}</Td>
              <Td className="tabular-nums">{formatTWD(product.basePrice)}</Td>
              <Td>
                <span className="tabular-nums">{product.variants.length} 種</span>
                <span className={cn('ml-2 tabular-nums text-xs', low ? 'text-sale' : 'text-taupe-500')}>
                  庫存 {totalStock}
                  {reserved > 0 && `（已佔 ${reserved}）`}
                </span>
              </Td>
              <Td>
                <Badge tone={product.status === 'ACTIVE' ? 'success' : 'muted'}>
                  {STATUS_LABEL[product.status]}
                </Badge>
              </Td>
            </tr>
          )
        })}
      </DataTable>

      <AdminPagination
        page={page}
        totalPages={Math.max(1, Math.ceil(total / PER_PAGE))}
        basePath="/admin/products"
        searchParams={sp}
      />
    </>
  )
}
