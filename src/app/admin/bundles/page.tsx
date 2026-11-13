import Link from 'next/link'
import { Plus } from 'lucide-react'
import { db } from '@/lib/db'
import { formatTWD } from '@/lib/utils'
import { bundleOriginalRange } from '@/lib/bundles/match'
import { PageHeader, DataTable, Td } from '@/components/admin/ui'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { BundleRowActions } from './bundle-row-actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: '組合商品' }

export default async function AdminBundlesPage() {
  const bundles = await db.bundle.findMany({
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      slug: true,
      name: true,
      price: true,
      isActive: true,
      _count: { select: { orderBundles: true } },
      items: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          qty: true,
          variant: { select: { name: true, price: true, isActive: true } },
          product: {
            select: {
              name: true,
              status: true,
              variants: { where: { isActive: true }, select: { price: true } },
            },
          },
        },
      },
    },
  })

  return (
    <>
      <PageHeader
        title="組合商品"
        description="購物車裡湊齊組合內容就自動折成組合價，可與折扣碼並用。排序在前的組合優先顯示。"
        action={
          <Button asChild>
            <Link href="/admin/bundles/new">
              <Plus size={15} />
              新增組合
            </Link>
          </Button>
        }
      />

      <DataTable
        headers={['組合', '內容', '組合價', '原價合計', '現省', '狀態', '']}
        empty={bundles.length === 0}
      >
        {bundles.map((bundle, index) => {
          const range = bundleOriginalRange(
            bundle.items.map((item) => ({
              qty: item.qty,
              prices: item.variant
                ? [item.variant.price]
                : item.product.variants.map((v) => v.price),
            })),
          )
          // 商品下架或規格停用了：組合不會套用，要提醒管理員
          const broken = bundle.items.some(
            (item) => item.product.status !== 'ACTIVE' || (item.variant && !item.variant.isActive),
          )
          const saving = range.min - bundle.price

          return (
            <tr key={bundle.id}>
              <Td>
                <Link
                  href={`/admin/bundles/${bundle.id}`}
                  className="text-ink-900 underline-offset-4 hover:underline"
                >
                  {bundle.name}
                </Link>
                <div className="font-mono text-xs text-taupe-500">/bundles/{bundle.slug}</div>
                {bundle._count.orderBundles > 0 && (
                  <div className="text-xs text-taupe-500">
                    已售出 {bundle._count.orderBundles} 筆訂單
                  </div>
                )}
              </Td>
              <Td className="text-xs leading-relaxed text-taupe-600">
                {bundle.items.map((item) => (
                  <div key={item.id}>
                    {item.product.name}
                    <span className="text-taupe-400">
                      {' '}
                      · {item.variant ? item.variant.name : '任一規格'} × {item.qty}
                    </span>
                  </div>
                ))}
              </Td>
              <Td className="tabular-nums">{formatTWD(bundle.price)}</Td>
              <Td className="tabular-nums text-taupe-600">
                {formatTWD(range.min)}
                {range.max > range.min && ` – ${formatTWD(range.max)}`}
              </Td>
              <Td className={`tabular-nums ${saving > 0 ? 'text-sale' : 'text-taupe-400'}`}>
                {saving > 0 ? formatTWD(saving) : '—'}
              </Td>
              <Td>
                <div className="flex flex-col items-start gap-1">
                  <Badge tone={bundle.isActive ? 'success' : 'muted'}>
                    {bundle.isActive ? '上架中' : '已下架'}
                  </Badge>
                  {bundle.isActive && (broken || saving <= 0) && (
                    <span className="text-xs text-sale">
                      {broken ? '有商品已下架，暫不套用' : '組合價不低於原價，暫不套用'}
                    </span>
                  )}
                </div>
              </Td>
              <Td>
                <BundleRowActions
                  bundleId={bundle.id}
                  name={bundle.name}
                  isActive={bundle.isActive}
                  isFirst={index === 0}
                  isLast={index === bundles.length - 1}
                />
              </Td>
            </tr>
          )
        })}
      </DataTable>
    </>
  )
}
