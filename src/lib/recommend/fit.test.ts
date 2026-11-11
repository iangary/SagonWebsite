import { describe, expect, it } from 'vitest'
import { evaluateSize, matchProduct, recommendBySize, sizeOfVariant } from './fit'
import { fit, makeCandidate } from './test-helpers'

const body = { heightCm: 160, weightKg: 52 }

describe('evaluateSize', () => {
  it('三項都在範圍內（含邊界）', () => {
    const e = evaluateSize(
      fit('M', { heightMin: 150, heightMax: 160, weightMin: 40, weightMax: 52, bustMin: 76, bustMax: 88 }),
      { ...body, bustCm: 80 },
    )
    expect(e.checks.map((c) => c.status)).toEqual(['ok', 'ok', 'ok'])
    expect(e).toMatchObject({ matched: 3, mismatched: 0 })
  })

  it('低於下限、高於上限分開標示', () => {
    const e = evaluateSize(fit('S', { heightMin: 165, heightMax: 175, weightMin: 40, weightMax: 48 }), body)
    expect(e.checks.map((c) => [c.dimension, c.status])).toEqual([
      ['height', 'low'],
      ['weight', 'high'],
      ['bust', 'unchecked'],
    ])
    expect(e.mismatched).toBe(2)
  })

  it('沒填胸圍、或那一列沒給範圍的項目不算分也不算錯', () => {
    const noBustInput = evaluateSize(fit('M', { heightMin: 150, heightMax: 170, bustMin: 76, bustMax: 88 }), body)
    expect(noBustInput.checks[2].status).toBe('unchecked')
    expect(noBustInput).toMatchObject({ matched: 1, mismatched: 0 })

    const noWeightRange = evaluateSize(fit('M', { heightMin: 150, heightMax: 170 }), body)
    expect(noWeightRange.checks[1].status).toBe('unchecked')
  })

  it('只有一端的範圍：另一端不設限', () => {
    expect(evaluateSize(fit('XL', { weightMin: 50 }), { ...body, weightKg: 90 }).checks[1].status).toBe('ok')
    expect(evaluateSize(fit('S', { weightMax: 50 }), body).checks[1].status).toBe('high')
  })

  it('越接近範圍中間 offCenter 越小', () => {
    const center = evaluateSize(fit('M', { heightMin: 150, heightMax: 170 }), body)
    const edge = evaluateSize(fit('M', { heightMin: 140, heightMax: 160 }), body)
    expect(center.offCenter).toBeLessThan(edge.offCenter)
  })
})

describe('sizeOfVariant', () => {
  it.each([
    ['白色M', 'M'],
    ['B26235WPSLN【L】', 'L'],
    ['粉色 XL', 'XL'],
    ['2XL', 'XXL'],
    ['Free', 'FREE'],
    ['26278WOLXM', null], // 型號尾巴的 M 不是尺寸
    ['奶油色', null],
  ])('%s → %s', (name, size) => {
    expect(sizeOfVariant(name)).toBe(size)
  })
})

describe('matchProduct', () => {
  const sized = (variants: string[]) =>
    makeCandidate({
      variants,
      fits: [
        fit('M', { heightMin: 150, heightMax: 163, weightMin: 40, weightMax: 55 }),
        fit('L', { heightMin: 158, heightMax: 170, weightMin: 52, weightMax: 65 }),
      ],
    })

  it('挑最合適的尺寸，其他也全符合的列在 alsoFits', () => {
    const m = matchProduct(sized(['白色M', '白色L']), body)
    expect(m).toMatchObject({ match: 'full', size: 'M', alsoFits: ['L'] })
  })

  it('沒現貨的尺寸不推薦', () => {
    const m = matchProduct(sized(['白色L']), body)
    expect(m).toMatchObject({ size: 'L', alsoFits: [] })
    // 體重 48 只適合 M，但 M 沒貨 → 推薦 L 並標示體重不符
    expect(matchProduct(sized(['白色L']), { heightCm: 160, weightKg: 48 })).toMatchObject({
      match: 'partial',
      size: 'L',
    })
  })

  it('規格名稱看不出尺寸時，每一列都適用', () => {
    expect(matchProduct(sized(['奶油色']), body)).toMatchObject({ match: 'full', size: 'M' })
  })

  it('沒有任何現貨規格就不推薦', () => {
    expect(matchProduct(sized([]), body)).toBeNull()
  })

  it('部分符合：註明哪一項不符與建議範圍', () => {
    const m = matchProduct(makeCandidate({ fits: [fit('FREE', { heightMin: 150, heightMax: 170, weightMin: 40, weightMax: 48 })] }), body)
    expect(m?.match).toBe('partial')
    expect(m?.checks.find((c) => c.dimension === 'weight')).toEqual({
      dimension: 'weight',
      status: 'high',
      min: 40,
      max: 48,
    })
  })

  it('一項都不符合的不推薦', () => {
    const c = makeCandidate({ fits: [fit('FREE', { heightMin: 170, heightMax: 180, weightMin: 60, weightMax: 70 })] })
    expect(matchProduct(c, body)).toBeNull()
  })

  it('部分符合時挑不符合項目較少、超出較少的尺寸', () => {
    const c = makeCandidate({
      variants: ['M', 'L'],
      fits: [
        fit('M', { heightMin: 150, heightMax: 158, weightMin: 40, weightMax: 50 }), // 兩項不符
        fit('L', { heightMin: 155, heightMax: 165, weightMin: 55, weightMax: 65 }), // 體重差 3
      ],
    })
    expect(matchProduct(c, body)).toMatchObject({ match: 'partial', size: 'L' })
  })
})

describe('recommendBySize', () => {
  it('全符合在前（越接近中間越前），部分符合在後；不符合的不出現', () => {
    const edge = makeCandidate({ id: 'edge', fits: [fit('FREE', { heightMin: 140, heightMax: 160, weightMin: 40, weightMax: 52 })] })
    const center = makeCandidate({ id: 'center', fits: [fit('FREE', { heightMin: 150, heightMax: 170, weightMin: 42, weightMax: 62 })] })
    const partial = makeCandidate({ id: 'partial', fits: [fit('FREE', { heightMin: 150, heightMax: 170, weightMin: 40, weightMax: 48 })] })
    const none = makeCandidate({ id: 'none', fits: [fit('FREE', { heightMin: 175, weightMin: 70 })] })

    const result = recommendBySize([partial, edge, none, center], body)
    expect(result.items.map((m) => m.candidate.card.id)).toEqual(['center', 'edge', 'partial'])
    expect(result).toMatchObject({ fullCount: 2, partialCount: 1 })
  })

  it('有填胸圍時，三項都驗證過的排在只驗證兩項的前面', () => {
    const withBust = makeCandidate({ id: 'bust', fits: [fit('FREE', { heightMin: 140, heightMax: 170, weightMin: 30, weightMax: 70, bustMin: 70, bustMax: 95 })] })
    const noBust = makeCandidate({ id: 'nobust', fits: [fit('FREE', { heightMin: 150, heightMax: 170, weightMin: 42, weightMax: 62 })] })
    const result = recommendBySize([noBust, withBust], { ...body, bustCm: 82 })
    expect(result.items.map((m) => m.candidate.card.id)).toEqual(['bust', 'nobust'])
  })

  it('最多回六件', () => {
    const many = Array.from({ length: 10 }, () => makeCandidate())
    expect(recommendBySize(many, body).items).toHaveLength(6)
  })

  it('沒有資料時回空結果', () => {
    expect(recommendBySize([], body)).toEqual({ items: [], fullCount: 0, partialCount: 0 })
  })
})
