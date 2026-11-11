/**
 * 尺寸推薦的比對與排序。純函式，不碰資料庫。
 *
 * 資料：每件商品的每個尺寸有一列適穿範圍（ProductFit：身高、體重、胸圍的上下限，留空＝不設限）。
 * 輸入：顧客的身高、體重（必填）與胸圍（選填）。
 *
 * 規則：
 *  1. 只看有現貨的尺寸：分尺寸的商品，那個尺寸要有現貨規格；單一尺寸（FREE）任一規格有現貨即可。
 *  2. 每個尺寸逐項比對：落在範圍內＝符合，低於下限／高於上限＝不符合。
 *     顧客沒填（胸圍）或那一列沒給範圍的項目不算分，也不算不符合。
 *  3. 每件商品挑最合適的一個尺寸：不符合的項目越少越好 → 符合的項目越多越好 →
 *     超出的幅度越小越好 → 越接近範圍中間越好（偏邊緣的容易穿起來太緊或太鬆）。
 *  4. 所有比對到的項目都符合＝「全符合」；至少一項符合但有項目不符＝「部分符合」；
 *     一項都沒符合的不推薦。
 *  5. 全符合的排前面（越接近範圍中間越前面），部分符合的排後面（不符合的項目少、超出幅度小的在前）。
 */

export type Dimension = 'height' | 'weight' | 'bust'
export const DIMENSIONS: Dimension[] = ['height', 'weight', 'bust']

export interface BodyInput {
  heightCm: number
  weightKg: number
  bustCm?: number
}

export interface FitRange {
  size: string
  heightMin: number | null
  heightMax: number | null
  weightMin: number | null
  weightMax: number | null
  bustMin: number | null
  bustMax: number | null
}

export type CheckStatus = 'ok' | 'low' | 'high' | 'unchecked'

export interface DimensionCheck {
  dimension: Dimension
  status: CheckStatus
  min: number | null
  max: number | null
}

export interface SizeEvaluation {
  size: string
  checks: DimensionCheck[]
  matched: number
  mismatched: number
  /** 超出範圍的幅度（以範圍寬度正規化後加總），越小越接近 */
  overshoot: number
  /** 符合的項目離範圍中心多遠（0＝正中間、1＝貼邊），取平均 */
  offCenter: number
}

/** 範圍只有一端或寬度為 0 時，用這個寬度來正規化超出幅度 */
const FALLBACK_SPAN: Record<Dimension, number> = { height: 10, weight: 10, bust: 8 }

function bounds(range: FitRange, dimension: Dimension): [number | null, number | null] {
  if (dimension === 'height') return [range.heightMin, range.heightMax]
  if (dimension === 'weight') return [range.weightMin, range.weightMax]
  return [range.bustMin, range.bustMax]
}

function valueOf(body: BodyInput, dimension: Dimension): number | undefined {
  if (dimension === 'height') return body.heightCm
  if (dimension === 'weight') return body.weightKg
  return body.bustCm
}

export function evaluateSize(range: FitRange, body: BodyInput): SizeEvaluation {
  const checks: DimensionCheck[] = []
  let matched = 0
  let mismatched = 0
  let overshoot = 0
  const centers: number[] = []

  for (const dimension of DIMENSIONS) {
    const [min, max] = bounds(range, dimension)
    const value = valueOf(body, dimension)
    if (value === undefined || (min === null && max === null)) {
      checks.push({ dimension, status: 'unchecked', min, max })
      continue
    }
    const span = min !== null && max !== null && max > min ? max - min : FALLBACK_SPAN[dimension]
    if (min !== null && value < min) {
      mismatched++
      overshoot += (min - value) / span
      checks.push({ dimension, status: 'low', min, max })
    } else if (max !== null && value > max) {
      mismatched++
      overshoot += (value - max) / span
      checks.push({ dimension, status: 'high', min, max })
    } else {
      matched++
      // 只有一端的範圍沒有「中間」，當作中等
      centers.push(min !== null && max !== null && max > min ? Math.abs(value - (min + max) / 2) / ((max - min) / 2) : 0.5)
      checks.push({ dimension, status: 'ok', min, max })
    }
  }

  const offCenter = centers.length ? centers.reduce((a, b) => a + b, 0) / centers.length : 1
  return { size: range.size, checks, matched, mismatched, overshoot, offCenter }
}

/** 由好到壞 */
export function compareEvaluations(a: SizeEvaluation, b: SizeEvaluation): number {
  return (
    a.mismatched - b.mismatched ||
    b.matched - a.matched ||
    a.overshoot - b.overshoot ||
    a.offCenter - b.offCenter
  )
}

// ---------------------------------------------------------------------------
// 尺寸 ↔ 規格
// ---------------------------------------------------------------------------

const SIZE_TOKEN = /(?:^|[^A-Za-z])(XXXL|3XL|XXL|2XL|XL|XS|S|M|L|F|FREE)(?:[^A-Za-z]|$)/i

/** 規格名稱裡的尺寸字樣（白色M → M、B26235WPSLN【L】→ L）。認不出就是 null。與匯入腳本的規則相同。 */
export function sizeOfVariant(name: string): string | null {
  const m = SIZE_TOKEN.exec(name.normalize('NFKC'))
  if (!m) return null
  const token = m[1].toUpperCase()
  if (token === 'F') return 'FREE'
  if (token === '2XL') return 'XXL'
  if (token === '3XL') return 'XXXL'
  return token
}

export interface FitCandidate<Card> {
  card: Card
  fits: FitRange[]
  /** 上架中且有現貨的規格名稱 */
  inStockVariants: string[]
}

export interface FitMatch<Card> {
  candidate: FitCandidate<Card>
  match: 'full' | 'partial'
  /** 建議的尺寸。FREE＝單一尺寸 */
  size: string
  /** 其他也全符合的尺寸（介於兩個尺寸之間的人兩個都可以） */
  alsoFits: string[]
  checks: DimensionCheck[]
  evaluation: SizeEvaluation
}

/** 這件商品哪些適穿列可以推薦（尺寸要有現貨） */
function usableFits<Card>(c: FitCandidate<Card>): FitRange[] {
  const stockSizes = new Set(c.inStockVariants.map(sizeOfVariant).filter((s): s is string => s !== null))
  // 規格名稱完全看不出尺寸 → 視為單一尺寸，每一列都適用（避免資料填了 M 但規格只寫顏色就整件消失）
  if (stockSizes.size === 0) return c.inStockVariants.length ? c.fits : []
  return c.fits.filter((f) => f.size === 'FREE' || stockSizes.has(f.size))
}

export function matchProduct<Card>(c: FitCandidate<Card>, body: BodyInput): FitMatch<Card> | null {
  const evaluations = usableFits(c)
    .map((f) => evaluateSize(f, body))
    .sort(compareEvaluations)
  const best = evaluations[0]
  if (!best || best.matched === 0) return null

  const match = best.mismatched === 0 ? 'full' : 'partial'
  const alsoFits =
    match === 'full'
      ? evaluations.slice(1).filter((e) => e.mismatched === 0 && e.matched > 0).map((e) => e.size)
      : []
  return { candidate: c, match, size: best.size, alsoFits, checks: best.checks, evaluation: best }
}

export const MAX_RESULTS = 6

/**
 * 全符合在前、部分符合在後，最多 MAX_RESULTS 件。
 * 同分時保留原本順序（呼叫端傳進來時已經依上架時間新到舊）。
 */
export function recommendBySize<Card>(
  candidates: FitCandidate<Card>[],
  body: BodyInput,
  limit = MAX_RESULTS,
): { items: FitMatch<Card>[]; fullCount: number; partialCount: number } {
  const matches = candidates.map((c) => matchProduct(c, body)).filter((m): m is FitMatch<Card> => m !== null)
  const full = matches
    .filter((m) => m.match === 'full')
    .sort((a, b) => b.evaluation.matched - a.evaluation.matched || a.evaluation.offCenter - b.evaluation.offCenter)
  const partial = matches.filter((m) => m.match === 'partial').sort((a, b) => compareEvaluations(a.evaluation, b.evaluation))
  return {
    items: [...full, ...partial].slice(0, limit),
    fullCount: full.length,
    partialCount: partial.length,
  }
}
