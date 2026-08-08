import 'server-only'
import { db } from '@/lib/db'
import { slugify } from '@/lib/utils'

/**
 * 產生一個資料庫裡還沒被用掉的 slug。
 *
 * 中文商品名經過 slugify 後仍是中文（Next.js 路由支援 unicode），
 * 所以「LUNALUZ 復古朱依紋睡衣」會變成 lunaluz-復古朱依紋睡衣。
 * 撞名時往後加 -2、-3。
 *
 * slug 一旦建立就不再變動（後台是唯讀欄位），因為它是對外連結與 SEO 的一部分。
 */
export async function uniqueSlug(
  table: 'product' | 'category' | 'brand',
  name: string,
  fallbackPrefix: string,
): Promise<string> {
  const base = slugify(name) || `${fallbackPrefix}-${Date.now().toString(36)}`

  for (let suffix = 0; suffix < 50; suffix++) {
    const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`

    const taken =
      table === 'product'
        ? await db.product.findUnique({ where: { slug: candidate }, select: { id: true } })
        : table === 'category'
          ? await db.category.findUnique({ where: { slug: candidate }, select: { id: true } })
          : await db.brand.findUnique({ where: { slug: candidate }, select: { id: true } })

    if (!taken) return candidate
  }

  // 幾乎不可能走到這裡，但總比無限迴圈或拋錯好
  return `${base}-${Date.now().toString(36)}`
}

/**
 * 自動產生 SKU。營運沒特別指定時用這個，格式 SG-{6碼}。
 * 撞號就重抽。
 */
export async function uniqueSku(prefix = 'SG'): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
    const taken = await db.productVariant.findUnique({
      where: { sku: candidate },
      select: { id: true },
    })
    if (!taken) return candidate
  }
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`
}
