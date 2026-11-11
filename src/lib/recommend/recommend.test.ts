import { describe, expect, it } from 'vitest'
import { recommend } from './recommend'
import { fit, makeCandidate } from './test-helpers'

describe('recommend', () => {
  it('轉成前端要的形狀：商品卡、全符合／部分符合、建議尺寸、各項比對結果', async () => {
    const result = await recommend({ heightCm: 160, weightKg: 52 }, async () => [
      makeCandidate({
        id: 'a',
        variants: ['白色M', '白色L'],
        fits: [
          fit('M', { heightMin: 150, heightMax: 165, weightMin: 40, weightMax: 55 }),
          fit('L', { heightMin: 158, heightMax: 172, weightMin: 50, weightMax: 65 }),
        ],
      }),
      makeCandidate({ id: 'b', fits: [fit('FREE', { heightMin: 150, heightMax: 170, weightMax: 50 })] }),
    ])

    expect(result.fullCount).toBe(1)
    expect(result.partialCount).toBe(1)
    expect(result.items.map((i) => [i.product.id, i.match, i.size, i.alsoFits])).toEqual([
      ['a', 'full', 'M', ['L']],
      ['b', 'partial', 'FREE', []],
    ])
    expect(result.items[1].checks.find((c) => c.dimension === 'weight')?.status).toBe('high')
    // 不把內部的比對分數送到前端
    expect(result.items[0]).not.toHaveProperty('evaluation')
  })
})
