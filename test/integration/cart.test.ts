import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', async () => (await import('./mocks')).authMockModule())
vi.mock('next/headers', async () => (await import('./mocks')).nextHeadersMockModule())
vi.mock('next/cache', async () => (await import('./mocks')).nextCacheMockModule())

import { db } from '@/lib/db'
import {
  CART_COOKIE,
  availableStock,
  getCartItemCount,
  getOrCreateCart,
} from '@/lib/cart'
import { addToCart, applyCoupon, removeCartItem, updateCartItemQty } from '@/lib/cart/actions'
import {
  createTestCart,
  createTestCoupon,
  createTestProduct,
  createTestUser,
} from '../factories'
import {
  MemoryCookieJar,
  mockAuthUser,
  resetCookieJar,
  revalidatePathMock,
} from './mocks'

/**
 * 購物車整合測試：訪客 cookie 認人、登入合併、加入/調整/移除、折扣碼。
 * 全部走真實測試庫，只 mock auth 與 Next 的 cookies/cache 邊界。
 */

let jar: MemoryCookieJar

beforeEach(() => {
  jar = resetCookieJar()
  mockAuthUser(null)
  revalidatePathMock.mockClear()
})

describe('getOrCreateCart（訪客）', () => {
  it('cookie 有 anonId 且購物車存在 → 回同一台車，不另建新車', async () => {
    const { variants } = await createTestProduct()
    const existing = await createTestCart({
      anonId: 'anon-guest-1',
      items: [{ variantId: variants[0].id, qty: 1 }],
    })
    jar.seed(CART_COOKIE, 'anon-guest-1')

    const cart = await getOrCreateCart()

    expect(cart.id).toBe(existing.id)
    expect(cart.anonId).toBe('anon-guest-1')
    expect(await db.cart.count()).toBe(1)
    // 既有的車不需要重發 cookie
    expect(jar.setCalls).toHaveLength(0)
  })

  it('沒有 cookie → 建新車並寫入 sagon_cart cookie（httpOnly/lax/30 天）', async () => {
    const cart = await getOrCreateCart()

    expect(cart.anonId).toBeTruthy()
    expect(cart.userId).toBeNull()

    const setCall = jar.setCalls.find((c) => c.name === CART_COOKIE)
    expect(setCall).toBeDefined()
    expect(setCall?.value).toBe(cart.anonId)
    expect(setCall?.options).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      secure: false, // NODE_ENV=test
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    })
  })
})

describe('getOrCreateCart（登入合併）', () => {
  it('同一個變體同時在匿名車與會員車 → 數量相加（2+3=5）而不是覆蓋，匿名車刪除', async () => {
    const user = await createTestUser()
    const { variants } = await createTestProduct({ stock: 10 })

    const anonCart = await createTestCart({
      anonId: 'anon-merge',
      items: [{ variantId: variants[0].id, qty: 2 }],
    })
    const userCart = await createTestCart({
      userId: user.id,
      items: [{ variantId: variants[0].id, qty: 3 }],
    })

    jar.seed(CART_COOKIE, 'anon-merge')
    mockAuthUser({ id: user.id, role: 'CUSTOMER' })

    const cart = await getOrCreateCart()

    expect(cart.id).toBe(userCart.id)
    expect(cart.items).toHaveLength(1)
    expect(cart.items[0].qty).toBe(5)
    expect(await db.cart.findUnique({ where: { id: anonCart.id } })).toBeNull()
  })

  it('會員沒有既有車 → 匿名車直接過戶（userId 設定、anonId 清空）', async () => {
    const user = await createTestUser()
    const { variants } = await createTestProduct()
    const anonCart = await createTestCart({
      anonId: 'anon-claim',
      items: [{ variantId: variants[0].id, qty: 2 }],
    })

    jar.seed(CART_COOKIE, 'anon-claim')
    mockAuthUser({ id: user.id, role: 'CUSTOMER' })

    const cart = await getOrCreateCart()

    expect(cart.id).toBe(anonCart.id)
    expect(cart.userId).toBe(user.id)
    expect(cart.anonId).toBeNull()
    expect(cart.items).toHaveLength(1)
    expect(await db.cart.count()).toBe(1)
  })

  it('匿名車是空的 → 刪掉匿名車、沿用會員車', async () => {
    const user = await createTestUser()
    const { variants } = await createTestProduct()
    const anonCart = await createTestCart({ anonId: 'anon-empty', items: [] })
    const userCart = await createTestCart({
      userId: user.id,
      items: [{ variantId: variants[0].id, qty: 1 }],
    })

    jar.seed(CART_COOKIE, 'anon-empty')
    mockAuthUser({ id: user.id, role: 'CUSTOMER' })

    const cart = await getOrCreateCart()

    expect(cart.id).toBe(userCart.id)
    expect(cart.items).toHaveLength(1)
    expect(await db.cart.findUnique({ where: { id: anonCart.id } })).toBeNull()
  })

  it('兩台車各有不同變體 → 合併後是聯集', async () => {
    const user = await createTestUser()
    const { variants } = await createTestProduct({ variantCount: 2 })

    await createTestCart({
      anonId: 'anon-union',
      items: [{ variantId: variants[0].id, qty: 1 }],
    })
    const userCart = await createTestCart({
      userId: user.id,
      items: [{ variantId: variants[1].id, qty: 2 }],
    })

    jar.seed(CART_COOKIE, 'anon-union')
    mockAuthUser({ id: user.id, role: 'CUSTOMER' })

    const cart = await getOrCreateCart()

    expect(cart.id).toBe(userCart.id)
    expect(cart.items).toHaveLength(2)
    const byVariant = new Map(cart.items.map((i) => [i.variantId, i.qty]))
    expect(byVariant.get(variants[0].id)).toBe(1)
    expect(byVariant.get(variants[1].id)).toBe(2)
    expect(await db.cart.count()).toBe(1)
  })
})

describe('addToCart', () => {
  it('數量超過 99 或小於 1 → 參數不正確', async () => {
    const { variants } = await createTestProduct()

    expect(await addToCart(variants[0].id, 100)).toEqual({ ok: false, error: '參數不正確' })
    expect(await addToCart(variants[0].id, 0)).toEqual({ ok: false, error: '參數不正確' })
    expect(await addToCart(variants[0].id, 1.5)).toEqual({ ok: false, error: '參數不正確' })
    expect(await db.cartItem.count()).toBe(0)
  })

  it('變體停用或商品非 ACTIVE → 這個規格已下架', async () => {
    const inactive = await createTestProduct({ isActiveVariant: false })
    expect(await addToCart(inactive.variants[0].id, 1)).toEqual({
      ok: false,
      error: '這個規格已下架',
    })

    const draft = await createTestProduct({ status: 'DRAFT' })
    expect(await addToCart(draft.variants[0].id, 1)).toEqual({
      ok: false,
      error: '這個規格已下架',
    })
  })

  it('可售數量 = 在庫 − 預扣：售完擋下、超量擋下', async () => {
    // stock 5、reserved 5 → 可售 0
    const soldOut = await createTestProduct({ stock: 5, reservedStock: 5 })
    expect(await addToCart(soldOut.variants[0].id, 1)).toEqual({
      ok: false,
      error: '這個規格已售完',
    })

    // stock 5、車上已有 2、再加 4 → 超過可售 5
    const { variants } = await createTestProduct({ stock: 5 })
    await createTestCart({
      anonId: 'anon-stock',
      items: [{ variantId: variants[0].id, qty: 2 }],
    })
    jar.seed(CART_COOKIE, 'anon-stock')

    expect(await addToCart(variants[0].id, 4)).toEqual({
      ok: false,
      error: '庫存不足，這個規格最多只能購買 5 件',
    })
    // 沒有寫入：車上仍是 2 件
    const item = await db.cartItem.findFirstOrThrow({ where: { variantId: variants[0].id } })
    expect(item.qty).toBe(2)
  })

  it('同一個變體加兩次 → upsert 成單一列、數量相加', async () => {
    const { variants } = await createTestProduct({ stock: 10 })

    const first = await addToCart(variants[0].id, 2)
    expect(first).toEqual({ ok: true, count: 2 })

    const second = await addToCart(variants[0].id, 3)
    expect(second).toEqual({ ok: true, count: 5 })

    const items = await db.cartItem.findMany({ where: { variantId: variants[0].id } })
    expect(items).toHaveLength(1)
    expect(items[0].qty).toBe(5)
    expect(revalidatePathMock).toHaveBeenCalledWith('/cart')
  })
})

describe('updateCartItemQty / removeCartItem', () => {
  it('數量 0 → 直接刪除項目', async () => {
    const { variants } = await createTestProduct({ stock: 10 })
    const cart = await createTestCart({
      anonId: 'anon-upd',
      items: [{ variantId: variants[0].id, qty: 2 }],
    })
    jar.seed(CART_COOKIE, 'anon-upd')

    const result = await updateCartItemQty(cart.items[0].id, 0)
    expect(result).toEqual({ ok: true, count: 0 })
    expect(await db.cartItem.count()).toBe(0)
  })

  it('數量非法（負數、>99）→ 數量不正確；超過可售 → 庫存不足', async () => {
    const { variants } = await createTestProduct({ stock: 5, reservedStock: 2 })
    const cart = await createTestCart({
      anonId: 'anon-upd2',
      items: [{ variantId: variants[0].id, qty: 1 }],
    })
    jar.seed(CART_COOKIE, 'anon-upd2')

    expect(await updateCartItemQty(cart.items[0].id, -1)).toEqual({
      ok: false,
      error: '數量不正確',
    })
    expect(await updateCartItemQty(cart.items[0].id, 100)).toEqual({
      ok: false,
      error: '數量不正確',
    })
    // 可售 = 5 - 2 = 3
    expect(await updateCartItemQty(cart.items[0].id, 4)).toEqual({
      ok: false,
      error: '庫存不足，這個規格最多只能購買 3 件',
    })

    const item = await db.cartItem.findUniqueOrThrow({ where: { id: cart.items[0].id } })
    expect(item.qty).toBe(1)
  })

  it('別人車上的 itemId → 找不到這個項目，且不動到對方的資料', async () => {
    const { variants } = await createTestProduct({ stock: 10 })
    const otherCart = await createTestCart({
      anonId: 'anon-victim',
      items: [{ variantId: variants[0].id, qty: 2 }],
    })
    // 自己是另一個訪客
    jar.seed(CART_COOKIE, 'anon-attacker')
    await createTestCart({ anonId: 'anon-attacker', items: [] })

    expect(await updateCartItemQty(otherCart.items[0].id, 9)).toEqual({
      ok: false,
      error: '找不到這個項目',
    })

    const item = await db.cartItem.findUniqueOrThrow({ where: { id: otherCart.items[0].id } })
    expect(item.qty).toBe(2)
  })

  it('removeCartItem 移除別人車上的項目 → 找不到這個項目，項目仍在', async () => {
    const { variants } = await createTestProduct({ stock: 10 })
    const otherCart = await createTestCart({
      anonId: 'anon-victim2',
      items: [{ variantId: variants[0].id, qty: 1 }],
    })
    jar.seed(CART_COOKIE, 'anon-attacker2')
    await createTestCart({ anonId: 'anon-attacker2', items: [] })

    expect(await removeCartItem(otherCart.items[0].id)).toEqual({
      ok: false,
      error: '找不到這個項目',
    })
    expect(await db.cartItem.findUnique({ where: { id: otherCart.items[0].id } })).not.toBeNull()
  })
})

describe('applyCoupon', () => {
  it('不存在或已停用 → 折扣碼不存在或已停用', async () => {
    jar.seed(CART_COOKIE, 'anon-coupon')
    await createTestCart({ anonId: 'anon-coupon', items: [] })

    expect(await applyCoupon('NOSUCH')).toEqual({ ok: false, error: '折扣碼不存在或已停用' })

    await createTestCoupon({ code: 'DISABLED', isActive: false })
    expect(await applyCoupon('DISABLED')).toEqual({ ok: false, error: '折扣碼不存在或已停用' })
  })

  it('尚未開始 / 已過期 → 對應錯誤訊息', async () => {
    jar.seed(CART_COOKIE, 'anon-coupon2')
    await createTestCart({ anonId: 'anon-coupon2', items: [] })

    await createTestCoupon({
      code: 'NOTYET',
      startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    expect(await applyCoupon('NOTYET')).toEqual({ ok: false, error: '折扣碼尚未開始' })

    await createTestCoupon({
      code: 'EXPIRED',
      endsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    })
    expect(await applyCoupon('EXPIRED')).toEqual({ ok: false, error: '折扣碼已過期' })
  })

  it('有效折扣碼 → 大寫存入；空字串 → 清除折扣碼', async () => {
    const cart = await createTestCart({ anonId: 'anon-coupon3', items: [] })
    jar.seed(CART_COOKIE, 'anon-coupon3')
    await createTestCoupon({ code: 'SAVE100' })

    // 小寫輸入也吃得下，統一轉大寫
    expect(await applyCoupon('  save100  ')).toEqual({ ok: true })
    let fresh = await db.cart.findUniqueOrThrow({ where: { id: cart.id } })
    expect(fresh.couponCode).toBe('SAVE100')

    expect(await applyCoupon('')).toEqual({ ok: true })
    fresh = await db.cart.findUniqueOrThrow({ where: { id: cart.id } })
    expect(fresh.couponCode).toBeNull()
  })
})

describe('getCartItemCount / availableStock', () => {
  it('getCartItemCount 加總所有項目的數量；沒車回 0', async () => {
    // 沒 cookie 也沒登入
    expect(await getCartItemCount()).toBe(0)

    const { variants } = await createTestProduct({ variantCount: 2 })
    await createTestCart({
      anonId: 'anon-count',
      items: [
        { variantId: variants[0].id, qty: 2 },
        { variantId: variants[1].id, qty: 3 },
      ],
    })
    jar.seed(CART_COOKIE, 'anon-count')

    expect(await getCartItemCount()).toBe(5)
  })

  it('availableStock 不會是負數（預扣大於在庫的邊界）', () => {
    expect(availableStock({ stock: 3, reservedStock: 5 })).toBe(0)
    expect(availableStock({ stock: 5, reservedStock: 5 })).toBe(0)
    expect(availableStock({ stock: 5, reservedStock: 2 })).toBe(3)
  })
})
