/**
 * 推薦模組的單元測試共用：造候選商品。檔名不是 *.test.ts，vitest 不會把它當測試跑。
 */
import type { FitRange } from './fit'
import type { Candidate } from './types'

let seq = 0

export function fit(size: string, ranges: Partial<Omit<FitRange, 'size'>> = {}): FitRange {
  return {
    size,
    heightMin: null,
    heightMax: null,
    weightMin: null,
    weightMax: null,
    bustMin: null,
    bustMax: null,
    ...ranges,
  }
}

export function makeCandidate(
  overrides: { id?: string; fits?: FitRange[]; variants?: string[] } = {},
): Candidate {
  seq += 1
  const id = overrides.id ?? `p${seq}`
  const variants = overrides.variants ?? ['單一規格']
  return {
    card: {
      id,
      slug: `slug-${id}`,
      name: `商品${seq}`,
      nameEn: null,
      basePrice: 1900,
      compareAtPrice: null,
      brand: { name: 'ULLALA', slug: 'ullala' },
      images: [],
      variants: variants.map(() => ({ stock: 2, reservedStock: 0, isActive: true, preorderEnabled: false })),
    },
    fits: overrides.fits ?? [fit('FREE', { heightMin: 150, heightMax: 170, weightMin: 40, weightMax: 60 })],
    inStockVariants: variants,
  }
}
