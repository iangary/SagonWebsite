import { describe, it, expect } from 'vitest'
import { matchBundles, bundleOriginalRange, type BundleLine, type BundleRule } from './match'

const line = (
  variantId: string,
  productId: string,
  unitPrice: number,
  qty: number,
): BundleLine => ({
  variantId,
  productId,
  unitPrice,
  qty,
})

const rule = (id: string, price: number, items: BundleRule['items']): BundleRule => ({
  id,
  name: id,
  price,
  items,
})

describe('matchBundles', () => {
  it('湊齊一組就折成組合價', () => {
    const r = matchBundles(
      [line('top-m', 'top', 990, 1), line('pants-m', 'pants', 790, 1)],
      [
        rule('set', 1500, [
          { productId: 'top', variantId: null, qty: 1 },
          { productId: 'pants', variantId: null, qty: 1 },
        ]),
      ],
    )
    expect(r.discount).toBe(280)
    expect(r.applied).toEqual([
      {
        bundleId: 'set',
        name: 'set',
        sets: 1,
        price: 1500,
        originalTotal: 1780,
        discount: 280,
      },
    ])
  })

  it('沒湊齊不折價', () => {
    const r = matchBundles(
      [line('top-m', 'top', 990, 2)],
      [
        rule('set', 1500, [
          { productId: 'top', variantId: null, qty: 1 },
          { productId: 'pants', variantId: null, qty: 1 },
        ]),
      ],
    )
    expect(r).toEqual({ applied: [], discount: 0 })
  })

  it('同一個組合可以湊好幾組，多出來的照原價', () => {
    const r = matchBundles(
      [line('a', 'p', 500, 5)],
      [rule('two', 800, [{ productId: 'p', variantId: null, qty: 2 }])],
    )
    expect(r.applied[0]).toMatchObject({
      sets: 2,
      originalTotal: 2000,
      discount: 400,
    })
  })

  it('指定規格只認那個規格', () => {
    const rules = [rule('white', 800, [{ productId: 'p', variantId: 'white-m', qty: 2 }])]
    expect(matchBundles([line('pink-m', 'p', 500, 2)], rules).discount).toBe(0)
    expect(matchBundles([line('white-m', 'p', 500, 2)], rules).discount).toBe(200)
  })

  it('任一規格：不同規格可以混搭成一組', () => {
    const r = matchBundles(
      [line('white-m', 'p', 500, 1), line('pink-l', 'p', 500, 1)],
      [rule('two', 800, [{ productId: 'p', variantId: null, qty: 2 }])],
    )
    expect(r.discount).toBe(200)
  })

  it('任一規格優先拿單價高的規格（顧客省最多）', () => {
    const r = matchBundles(
      [line('cheap', 'p', 400, 1), line('pricey', 'p', 600, 1)],
      [rule('one', 450, [{ productId: 'p', variantId: null, qty: 1 }])],
    )
    // 兩件各成一組：600→450 省 150；400 < 450 不套用
    expect(r.applied[0]).toMatchObject({
      sets: 1,
      originalTotal: 600,
      discount: 150,
    })
  })

  it('先滿足指定規格，任一規格不會把它搶走', () => {
    const r = matchBundles(
      [line('white', 'p', 500, 1), line('pink', 'p', 500, 1)],
      [
        rule('mix', 800, [
          // 「任一規格」寫在前面也一樣：配對時一律先處理指定規格
          { productId: 'p', variantId: null, qty: 1 },
          { productId: 'p', variantId: 'white', qty: 1 },
        ]),
      ],
    )
    expect(r.discount).toBe(200)
  })

  it('組合價不低於原價時不套用', () => {
    const r = matchBundles(
      [line('a', 'p', 500, 2)],
      [rule('bad', 1000, [{ productId: 'p', variantId: null, qty: 2 }])],
    )
    expect(r.discount).toBe(0)
  })

  it('一件商品只能算進一組：兩個組合搶同一件時挑省比較多的', () => {
    const r = matchBundles(
      [line('top', 'top', 1000, 1), line('pants', 'pants', 800, 1), line('robe', 'robe', 1200, 1)],
      [
        rule('top+pants', 1600, [
          { productId: 'top', variantId: null, qty: 1 },
          { productId: 'pants', variantId: null, qty: 1 },
        ]),
        rule('top+robe', 1800, [
          { productId: 'top', variantId: null, qty: 1 },
          { productId: 'robe', variantId: null, qty: 1 },
        ]),
      ],
    )
    expect(r.applied).toHaveLength(1)
    expect(r.applied[0]).toMatchObject({ bundleId: 'top+robe', discount: 400 })
    expect(r.discount).toBe(400)
  })

  it('同一個規格分在多行（理論上不會發生）也會合併計算', () => {
    const r = matchBundles(
      [line('a', 'p', 500, 1), line('a', 'p', 500, 1)],
      [rule('two', 800, [{ productId: 'p', variantId: null, qty: 2 }])],
    )
    expect(r.discount).toBe(200)
  })

  it('沒有項目、數量不合法的組合不會套用', () => {
    const lines = [line('a', 'p', 500, 3)]
    expect(matchBundles(lines, [rule('empty', 1, [])]).discount).toBe(0)
    expect(
      matchBundles(lines, [rule('zero', 1, [{ productId: 'p', variantId: null, qty: 0 }])])
        .discount,
    ).toBe(0)
  })

  it('指定的規格屬於別的商品時不算', () => {
    const r = matchBundles(
      [line('v', 'other', 500, 2)],
      [rule('r', 800, [{ productId: 'p', variantId: 'v', qty: 2 }])],
    )
    expect(r.discount).toBe(0)
  })
})

describe('bundleOriginalRange', () => {
  it('任一規格的項目取最便宜與最貴的規格', () => {
    expect(
      bundleOriginalRange([
        { qty: 2, prices: [500, 600] },
        { qty: 1, prices: [800] },
      ]),
    ).toEqual({ min: 1800, max: 2000 })
  })
})
