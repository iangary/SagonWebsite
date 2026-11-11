import { beforeEach, describe, expect, it, vi } from 'vitest'

// Redis 換成記憶體版
const redisStore = new Map<string, number>()
const fakeRedis = {
  incr: vi.fn(async (key: string) => {
    const n = (redisStore.get(key) ?? 0) + 1
    redisStore.set(key, n)
    return n
  }),
  expire: vi.fn(async () => 1),
}
vi.mock('@/lib/queue', async () => ({
  ...(await import('./mocks')).queueMockModule(),
  getRedis: () => fakeRedis,
}))

import { db } from '@/lib/db'
import { POST } from '@/app/api/recommend/route'
import { hasFitData, loadCandidates } from '@/lib/recommend/candidates'
import { RATE_LIMIT } from '@/lib/recommend/guard'
import type { RecommendResult } from '@/lib/recommend/types'
import { createTestProduct } from '../factories'

function post(body: unknown, ip = '203.0.113.7') {
  return POST(
    new Request('http://localhost/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  )
}

const FREE_160 = { size: 'FREE', heightMin: 150, heightMax: 170, weightMin: 42, weightMax: 60 }

async function addFits(productId: string, fits: Record<string, unknown>[]) {
  await db.productFit.createMany({ data: fits.map((f) => ({ productId, size: 'FREE', ...f })) })
}

async function renameVariants(productId: string, names: string[]) {
  const variants = await db.productVariant.findMany({ where: { productId }, orderBy: { sortOrder: 'asc' } })
  await Promise.all(variants.map((v, i) => db.productVariant.update({ where: { id: v.id }, data: { name: names[i] } })))
}

beforeEach(() => {
  redisStore.clear()
  fakeRedis.incr.mockClear()
})

describe('loadCandidates / hasFitData', () => {
  it('只收上架中、有適穿資料、而且真的有現貨的商品', async () => {
    expect(await hasFitData()).toBe(false)

    const ok = await createTestProduct({ stock: 3 })
    const noFits = await createTestProduct({ stock: 3 })
    const reservedOut = await createTestProduct({ stock: 2, reservedStock: 2 })
    const archived = await createTestProduct({ status: 'ARCHIVED' })
    const soldOut = await createTestProduct({ stock: 0 })
    for (const p of [ok, reservedOut, archived, soldOut]) await addFits(p.product.id, [FREE_160])

    const ids = (await loadCandidates()).map((c) => c.card.id)
    expect(ids).toEqual([ok.product.id])
    expect(ids).not.toContain(noFits.product.id)
    expect(await hasFitData()).toBe(true)
  })

  it('只有下架商品有資料時，首頁不顯示尺寸推薦', async () => {
    const archived = await createTestProduct({ status: 'ARCHIVED' })
    await addFits(archived.product.id, [FREE_160])
    expect(await hasFitData()).toBe(false)
  })

  it('刪除商品時適穿資料跟著刪', async () => {
    const p = await createTestProduct()
    await addFits(p.product.id, [FREE_160])
    await db.product.delete({ where: { id: p.product.id } })
    expect(await db.productFit.count()).toBe(0)
  })
})

describe('POST /api/recommend', () => {
  it('全符合在前、部分符合在後，並回建議尺寸與不符合的項目', async () => {
    const sized = await createTestProduct({ stock: 3, variantCount: 2, name: '分尺寸套裝' })
    await renameVariants(sized.product.id, ['白色M', '白色L'])
    await addFits(sized.product.id, [
      { size: 'M', heightMin: 150, heightMax: 163, weightMin: 40, weightMax: 55 },
      { size: 'L', heightMin: 158, heightMax: 170, weightMin: 52, weightMax: 65 },
    ])
    const tight = await createTestProduct({ stock: 3, name: '偏小洋裝' })
    await addFits(tight.product.id, [{ heightMin: 150, heightMax: 170, weightMin: 38, weightMax: 48 }])
    const tall = await createTestProduct({ stock: 3, name: '高個子款' })
    await addFits(tall.product.id, [{ heightMin: 170, heightMax: 185, weightMin: 60, weightMax: 80 }])

    const res = await post({ heightCm: 160, weightKg: 52 })
    expect(res.status).toBe(200)
    const body = (await res.json()) as RecommendResult
    expect(body).toMatchObject({ fullCount: 1, partialCount: 1 })
    expect(body.items.map((i) => [i.product.id, i.match, i.size, i.alsoFits])).toEqual([
      [sized.product.id, 'full', 'M', ['L']],
      [tight.product.id, 'partial', 'FREE', []],
    ])
    expect(body.items[1].checks).toContainEqual({ dimension: 'weight', status: 'high', min: 38, max: 48 })
  })

  it('胸圍選填：有填才比對', async () => {
    const p = await createTestProduct({ stock: 3 })
    await addFits(p.product.id, [{ ...FREE_160, bustMin: 76, bustMax: 88 }])

    const without = (await (await post({ heightCm: 160, weightKg: 52 })).json()) as RecommendResult
    expect(without.items[0].match).toBe('full')

    const tooBig = (await (await post({ heightCm: 160, weightKg: 52, bustCm: 95 })).json()) as RecommendResult
    expect(tooBig.items[0]).toMatchObject({ match: 'partial' })
    expect(tooBig.items[0].checks).toContainEqual({ dimension: 'bust', status: 'high', min: 76, max: 88 })
  })

  it('沒有符合的商品時回空結果', async () => {
    const p = await createTestProduct({ stock: 3 })
    await addFits(p.product.id, [FREE_160])
    const body = (await (await post({ heightCm: 185, weightKg: 90 })).json()) as RecommendResult
    expect(body).toEqual({ items: [], fullCount: 0, partialCount: 0 })
  })

  it.each([
    ['不是 JSON', '{'],
    ['缺體重', { heightCm: 160 }],
    ['身高用公尺', { heightCm: 1.6, weightKg: 52 }],
    ['體重用公克', { heightCm: 160, weightKg: 52000 }],
    ['胸圍不是數字', { heightCm: 160, weightKg: 52, bustCm: '80' }],
  ])('輸入不合格（%s）回 400', async (_label, body) => {
    const res = await post(body)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ code: 'INVALID' })
  })

  it(`同一 IP 第 ${RATE_LIMIT + 1} 次回 429 並帶 Retry-After，其他 IP 不受影響`, async () => {
    for (let i = 0; i < RATE_LIMIT; i++) {
      expect((await post({ heightCm: 160, weightKg: 50 + (i % 5) }, '198.51.100.1')).status).toBe(200)
    }
    const blocked = await post({ heightCm: 160, weightKg: 52 }, '198.51.100.1')
    expect(blocked.status).toBe(429)
    expect(await blocked.json()).toEqual({ code: 'RATE_LIMITED' })
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect((await post({ heightCm: 160, weightKg: 52 }, '198.51.100.2')).status).toBe(200)
  })

  it('Redis 故障時不擋顧客', async () => {
    const p = await createTestProduct({ stock: 3 })
    await addFits(p.product.id, [FREE_160])
    fakeRedis.incr.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await post({ heightCm: 160, weightKg: 52 })
    expect(res.status).toBe(200)
    expect(((await res.json()) as RecommendResult).items).toHaveLength(1)
    warn.mockRestore()
  })
})
