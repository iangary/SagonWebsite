import type { ProductCardData } from '@/lib/catalog/queries'
import type { DimensionCheck, FitCandidate } from './fit'

export type Candidate = FitCandidate<ProductCardData>

/** API 回給前端的一件推薦。理由文字由前端依語系組（見 product-recommender.tsx）。 */
export interface RecommendationItem {
  product: ProductCardData
  match: 'full' | 'partial'
  /** 建議尺寸；FREE＝單一尺寸 */
  size: string
  alsoFits: string[]
  checks: DimensionCheck[]
}

export interface RecommendResult {
  items: RecommendationItem[]
  fullCount: number
  partialCount: number
}
