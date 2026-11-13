import 'server-only'
import { db } from '@/lib/db'

export interface BundleProductOption {
  id: string
  name: string
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED'
  variants: { id: string; name: string; price: number; isActive: boolean }[]
}

/**
 * 組合表單的商品選單：未封存的商品，加上這個組合原本就有的（即使已封存，才看得出來要換掉哪一項）。
 */
export async function loadBundleProductOptions(
  includeProductIds: string[] = [],
): Promise<BundleProductOption[]> {
  return db.product.findMany({
    where: {
      OR: [{ status: { not: 'ARCHIVED' } }, { id: { in: includeProductIds } }],
    },
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      status: true,
      variants: {
        orderBy: { sortOrder: 'asc' },
        select: { id: true, name: true, price: true, isActive: true },
      },
    },
  })
}
