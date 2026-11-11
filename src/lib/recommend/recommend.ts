/**
 * 尺寸推薦：候選商品 + 顧客身形 → API 回應。資料來源用注入的，單元測試不需要資料庫。
 */
import { recommendBySize, type BodyInput } from './fit'
import type { Candidate, RecommendResult } from './types'

export async function recommend(
  body: BodyInput,
  loadCandidates: () => Promise<Candidate[]>,
): Promise<RecommendResult> {
  const { items, fullCount, partialCount } = recommendBySize(await loadCandidates(), body)
  return {
    items: items.map(({ candidate, match, size, alsoFits, checks }) => ({
      product: candidate.card,
      match,
      size,
      alsoFits,
      checks,
    })),
    fullCount,
    partialCount,
  }
}
