import 'server-only'
import { db } from '@/lib/db'
import { PRODUCT_CARD_SELECT } from '@/lib/catalog/queries'
import { hasStock } from '@/lib/catalog/stock'
import type { Candidate } from './types'

const FIT_SELECT = {
  size: true,
  heightMin: true,
  heightMax: true,
  weightMin: true,
  weightMax: true,
  bustMin: true,
  bustMax: true,
} as const

/**
 * 尺寸推薦的候選：上架中、有適穿資料、而且真的有現貨（stock - reservedStock > 0）的商品。
 *
 * 有適穿資料的商品頂多幾百件，一次撈完在記憶體裡比對 —— 範圍比對要逐尺寸算
 * 「超出多少、離中間多遠」來排序，寫成 SQL 反而難讀。
 * 只開預購、沒有現貨的不推薦：推薦的承諾是「現在買得到這個尺寸」。
 */
export async function loadCandidates(): Promise<Candidate[]> {
  const rows = await db.product.findMany({
    where: {
      status: 'ACTIVE',
      fits: { some: {} },
      variants: { some: { isActive: true, stock: { gt: 0 } } },
    },
    orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    select: {
      ...PRODUCT_CARD_SELECT,
      fits: { select: FIT_SELECT },
      variants: {
        select: { name: true, stock: true, reservedStock: true, isActive: true, preorderEnabled: true },
        orderBy: { sortOrder: 'asc' },
      },
    },
  })

  return rows
    .filter((row) => hasStock(row))
    .map(({ fits, variants, ...card }) => ({
      card: {
        ...card,
        variants: variants.map(({ stock, reservedStock, isActive, preorderEnabled }) => ({
          stock,
          reservedStock,
          isActive,
          preorderEnabled,
        })),
      },
      fits,
      inStockVariants: variants
        .filter((v) => v.isActive && v.stock - v.reservedStock > 0)
        .map((v) => v.name),
    }))
}

/**
 * 首頁要不要顯示尺寸推薦：至少有一件上架商品填了適穿資料。
 * 對照表還沒匯入時整區不顯示，免得客人填完數字只看到「沒有符合的商品」。
 */
export async function hasFitData(): Promise<boolean> {
  const count = await db.productFit.count({ where: { product: { status: 'ACTIVE' } } })
  return count > 0
}
