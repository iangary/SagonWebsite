/**
 * 組合優惠的配對：購物車裡湊齊了哪些組合、各幾組、折掉多少。
 *
 * 不碰 DB 的純函式 —— 購物車頁、結帳頁、成立訂單三處共用同一份，
 * 金額永遠由伺服器拿資料庫裡的價格重算，前端送來的東西不參與計算。
 *
 * 規則：
 *  - 組合項目指定了規格（variantId）就只認那個規格；沒指定就是該商品任一規格都算。
 *  - 同一件商品既有「指定規格」又有「任一規格」的項目時，先滿足指定規格的，
 *    免得「任一規格」把指定的那件搶走、害整組湊不起來。
 *  - 「任一規格」的項目優先拿單價高的規格：組合價固定，拿貴的那件顧客省最多。
 *  - 一件商品只能被算進一組，同一個組合可以湊很多組。
 *  - 每一輪挑「這一組省最多」的組合套用，直到湊不出任何一組為止（貪婪法）。
 *    組合之間搶同一件商品時不保證是全域最佳解，但結果是確定的，而且每一組都真的有省到。
 *  - 組合價不低於被吃掉的原價合計時不套用 —— 那組對顧客沒有好處。
 */

export interface BundleRuleItem {
  productId: string
  /** null = 這件商品任一規格都算 */
  variantId: string | null
  qty: number
}

export interface BundleRule {
  id: string
  name: string
  /** 一組的組合價 */
  price: number
  items: BundleRuleItem[]
}

export interface BundleLine {
  variantId: string
  productId: string
  unitPrice: number
  qty: number
}

export interface AppliedBundle {
  bundleId: string
  name: string
  sets: number
  /** 一組的組合價 */
  price: number
  /** 被這幾組吃掉的品項原價合計 */
  originalTotal: number
  /** = originalTotal - price × sets */
  discount: number
}

export interface BundleMatchResult {
  applied: AppliedBundle[]
  /** 所有組合折掉的總額 */
  discount: number
}

interface PoolEntry {
  variantId: string
  productId: string
  unitPrice: number
  remaining: number
}

/** 試著從剩下的品項湊出一組；湊不齊回 null。不會動到 pool 本身。 */
function trySet(
  rule: BundleRule,
  pool: Map<string, PoolEntry>,
): { value: number; takes: Map<string, number> } | null {
  if (rule.items.length === 0) return null

  const takes = new Map<string, number>()
  const left = (entry: PoolEntry) => entry.remaining - (takes.get(entry.variantId) ?? 0)
  let value = 0

  // 指定規格的先拿，再拿任一規格的
  const ordered = [
    ...rule.items.filter((item) => item.variantId !== null),
    ...rule.items.filter((item) => item.variantId === null),
  ]

  for (const item of ordered) {
    if (item.qty <= 0) return null
    let need = item.qty

    const candidates =
      item.variantId !== null
        ? [pool.get(item.variantId)].filter(
            (entry): entry is PoolEntry =>
              entry !== undefined && entry.productId === item.productId,
          )
        : [...pool.values()]
            .filter((entry) => entry.productId === item.productId)
            // 單價高的先拿；同價時依 variantId 排，結果才穩定
            .sort((a, b) => b.unitPrice - a.unitPrice || a.variantId.localeCompare(b.variantId))

    for (const entry of candidates) {
      if (need === 0) break
      const take = Math.min(need, left(entry))
      if (take <= 0) continue
      takes.set(entry.variantId, (takes.get(entry.variantId) ?? 0) + take)
      value += take * entry.unitPrice
      need -= take
    }

    if (need > 0) return null
  }

  return { value, takes }
}

export function matchBundles(lines: BundleLine[], rules: BundleRule[]): BundleMatchResult {
  const pool = new Map<string, PoolEntry>()
  for (const line of lines) {
    if (line.qty <= 0) continue
    const existing = pool.get(line.variantId)
    if (existing) existing.remaining += line.qty
    else pool.set(line.variantId, { ...line, remaining: line.qty })
  }

  const applied = new Map<string, AppliedBundle>()

  // 每一輪至少吃掉一件商品，件數有上限，迴圈一定會結束
  for (;;) {
    let best: {
      rule: BundleRule
      value: number
      takes: Map<string, number>
    } | null = null

    for (const rule of rules) {
      if (rule.price < 0) continue
      const set = trySet(rule, pool)
      if (!set || set.value - rule.price <= 0) continue
      // 嚴格大於：同樣省的話留給排序在前的組合
      if (!best || set.value - rule.price > best.value - best.rule.price) {
        best = { rule, ...set }
      }
    }

    if (!best) break

    for (const [variantId, take] of best.takes) pool.get(variantId)!.remaining -= take

    const entry = applied.get(best.rule.id) ?? {
      bundleId: best.rule.id,
      name: best.rule.name,
      sets: 0,
      price: best.rule.price,
      originalTotal: 0,
      discount: 0,
    }
    entry.sets += 1
    entry.originalTotal += best.value
    entry.discount = entry.originalTotal - entry.price * entry.sets
    applied.set(best.rule.id, entry)
  }

  // 依 rules 的順序輸出（= 後台排序），畫面上比較好對照
  const result = rules
    .map((rule) => applied.get(rule.id))
    .filter((entry): entry is AppliedBundle => entry !== undefined)

  return {
    applied: result,
    discount: result.reduce((sum, b) => sum + b.discount, 0),
  }
}

/**
 * 組合單獨看時的原價範圍：「任一規格」的項目取最便宜／最貴的規格。
 * 給組合列表、商品頁的提示用 —— 實際折多少以 matchBundles 在購物車裡算的為準。
 */
export function bundleOriginalRange(items: { qty: number; prices: number[] }[]): {
  min: number
  max: number
} {
  let min = 0
  let max = 0
  for (const item of items) {
    if (item.prices.length === 0) continue
    min += Math.min(...item.prices) * item.qty
    max += Math.max(...item.prices) * item.qty
  }
  return { min, max }
}
