import { describe, it, expect } from 'vitest'
import {
  BUNDLE_JSON_EXAMPLE,
  bundleToJson,
  parseBundleJson,
  type BundleJsonProduct,
} from './bundle-json'

const PRODUCTS: BundleJsonProduct[] = [
  {
    id: 'p-top',
    slug: 'linen-top',
    name: '亞麻上衣',
    variants: [
      { id: 'v-top-m', sku: 'TOP-M', name: '白色 / M' },
      { id: 'v-top-l', sku: 'TOP-L', name: '白色 / L' },
    ],
  },
  {
    id: 'p-pants',
    slug: 'linen-pants',
    name: '亞麻褲',
    variants: [{ id: 'v-pants', sku: 'PANTS', name: '單一規格' }],
  },
  // 同名商品：用名稱指定會有歧義
  { id: 'p-dup1', slug: 'dup-1', name: '同名商品', variants: [] },
  { id: 'p-dup2', slug: 'dup-2', name: '同名商品', variants: [] },
]

const parse = (doc: unknown) => parseBundleJson(JSON.stringify(doc), PRODUCTS)

describe('parseBundleJson', () => {
  it('商品用 slug／ID／名稱、規格用 SKU／名稱／null 都能對上', () => {
    const r = parse({
      name: ' 上衣褲子組 ',
      price: 1800,
      isActive: true,
      items: [
        { product: 'linen-top', variant: 'TOP-M', qty: 2 },
        { product: 'p-top', variant: '白色 / L' },
        { product: '亞麻褲', variant: null },
        { product: 'linen-pants', variant: '任一規格' },
      ],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.values).toMatchObject({
      name: '上衣褲子組',
      price: 1800,
      isActive: true,
      sortOrder: 0,
    })
    expect(r.values.items).toEqual([
      { productId: 'p-top', variantId: 'v-top-m', qty: 2 },
      { productId: 'p-top', variantId: 'v-top-l', qty: 1 },
      { productId: 'p-pants', variantId: null, qty: 1 },
      { productId: 'p-pants', variantId: null, qty: 1 },
    ])
    expect(r.warnings).toEqual([])
  })

  it('JSON 語法錯誤：指出大約第幾行', () => {
    const r = parseBundleJson('{\n  "name": "x",\n  "price": 100,,\n}', PRODUCTS)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors[0]).toMatch(/JSON 格式錯誤/)
  })

  it('必填與型別錯誤一次全部列出', () => {
    const r = parse({ price: '1800', isActive: 'yes', sortOrder: -1, items: [] })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('name'),
        expect.stringContaining('price'),
        expect.stringContaining('isActive'),
        expect.stringContaining('sortOrder'),
        expect.stringContaining('items'),
      ]),
    )
  })

  it('找不到商品、規格不存在、名稱有歧義、數量超出範圍', () => {
    const r = parse({
      name: '錯誤示範',
      price: 100,
      items: [
        { product: 'nope' },
        { product: 'linen-top', variant: '粉色 / S' },
        { product: '同名商品' },
        { product: 'linen-pants', qty: 21 },
      ],
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toHaveLength(4)
    expect(r.errors[0]).toMatch(/第 1 項找不到商品「nope」/)
    expect(r.errors[1]).toMatch(/沒有規格「粉色 \/ S」，可選：白色 \/ M、白色 \/ L/)
    expect(r.errors[2]).toMatch(/對到 2 件商品，請改用 slug/)
    expect(r.errors[3]).toMatch(/qty/)
  })

  it('最外層是陣列或不是物件 → 拒絕', () => {
    expect(parseBundleJson('[]', PRODUCTS).ok).toBe(false)
    expect(parseBundleJson('"x"', PRODUCTS).ok).toBe(false)
    expect(parseBundleJson('   ', PRODUCTS).ok).toBe(false)
  })

  it('不認得的欄位只警告，不擋', () => {
    const r = parse({
      name: 'x',
      price: 1,
      color: 'red',
      items: [{ product: 'linen-top', foo: 1 }],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.warnings).toEqual([
      '不認得的欄位「color」，已忽略',
      '第 1 項有不認得的欄位「foo」，已忽略',
    ])
  })

  it('範例本身是合法的 JSON（只是商品要換成真的）', () => {
    expect(() => JSON.parse(BUNDLE_JSON_EXAMPLE)).not.toThrow()
  })
})

describe('bundleToJson', () => {
  it('匯出用 slug 與 SKU，再匯入得到同樣的值（往返不失真）', () => {
    const values = {
      name: '上衣褲子組',
      nameEn: 'Top & Pants',
      slug: 'top-pants',
      description: '一起買更划算',
      descriptionEn: '',
      price: 1800 as const,
      sortOrder: 10,
      isActive: true,
      items: [
        { productId: 'p-top', variantId: 'v-top-m', qty: 1 },
        { productId: 'p-pants', variantId: null, qty: 2 },
      ],
    }
    const json = bundleToJson(values, PRODUCTS)
    const doc = JSON.parse(json)
    expect(doc.items).toEqual([
      { product: 'linen-top', variant: 'TOP-M', qty: 1, note: '亞麻上衣（白色 / M）' },
      { product: 'linen-pants', variant: null, qty: 2, note: '亞麻褲（任一規格）' },
    ])

    const back = parseBundleJson(json, PRODUCTS)
    expect(back.ok).toBe(true)
    if (back.ok) expect(back.values).toEqual(values)
  })
})
