import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/queue', async () => (await import('./mocks')).queueMockModule())
vi.mock('@/lib/auth', async () => (await import('./mocks')).authMockModule())
vi.mock('next/headers', async () => (await import('./mocks')).nextHeadersMockModule())
vi.mock('next/cache', async () => (await import('./mocks')).nextCacheMockModule())
vi.mock('@/lib/ecpay/receipt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ecpay/receipt')>()
  return { ...actual, issueReceipt: vi.fn(), invalidReceipt: vi.fn() }
})

import type { User } from '@prisma/client'
import { db } from '@/lib/db'
import { createOrderFromCart, type CreateOrderInput } from '@/lib/orders/create'
import { handlePaymentReturn } from '@/lib/orders/payment'
import { issueReceiptForOrder } from '@/lib/orders/receipt'
import { issueReceipt } from '@/lib/ecpay/receipt'
import { DEFAULT_SHIPPING_SETTINGS } from '@/lib/shop-settings'
import { addBundleToCart } from '@/lib/bundles/actions'
import { getStorefrontBundles, matchCartBundles } from '@/lib/bundles'
import {
  deleteBundle,
  moveBundle,
  saveBundle,
  toggleBundle,
  type BundleFormState,
} from '@/app/admin/bundles/actions'
import { deleteProduct, deleteVariant } from '@/app/admin/products/actions'
import { createTestCart, createTestCoupon, createTestProduct, createTestUser } from '../factories'
import { getCookieJar, mockAuthUser, resetCookieJar } from './mocks'
import { signedPaymentReturnParams } from './helpers/ecpay'

/**
 * 組合優惠的整合測試：後台 CRUD、加入購物車、結帳計價、付款回拋、收據。
 *
 * 金額一律由伺服器拿資料庫裡的售價重算 —— 這裡的每個「下單」案例都是從真的購物車資料列開始，
 * 斷言訂單、付款、物流代收、發票、收據上的金額全部一致。
 */

const { homeFee: HOME_FEE, freeShippingThreshold: FREE_THRESHOLD } = DEFAULT_SHIPPING_SETTINGS

function orderInput(overrides: Partial<CreateOrderInput> = {}): CreateOrderInput {
  return {
    email: 'buyer@test.local',
    phone: '0912345678',
    recipientName: '測試買家',
    recipientPhone: '0987654321',
    // 超商取貨預設關閉（shop_settings 是空的），宅配一定開著
    shippingMethod: 'HOME',
    logisticsSubType: 'TCAT',
    addressZip: '104',
    addressCity: '台北市',
    addressDistrict: '中山區',
    addressLine: '南京東路一段 1 號',
    choosePayment: 'Credit',
    invoice: { isB2B: false },
    ...overrides,
  }
}

async function createBundle(input: {
  price: number
  items: { productId: string; variantId?: string | null; qty?: number }[]
  isActive?: boolean
  sortOrder?: number
  name?: string
}) {
  const name = input.name ?? `測試組合${Math.random().toString(36).slice(2, 7)}`
  return db.bundle.create({
    data: {
      slug: `bundle-${Math.random().toString(36).slice(2, 10)}`,
      name,
      price: input.price,
      isActive: input.isActive ?? true,
      sortOrder: input.sortOrder ?? 0,
      items: {
        create: input.items.map((item, i) => ({
          productId: item.productId,
          variantId: item.variantId ?? null,
          qty: item.qty ?? 1,
          sortOrder: i,
        })),
      },
    },
    include: { items: true },
  })
}

async function memberWithCart(items: { variantId: string; qty: number }[], couponCode?: string) {
  const user = await createTestUser()
  const cart = await createTestCart({ userId: user.id, items, couponCode })
  mockAuthUser({ id: user.id, role: 'CUSTOMER', email: user.email })
  return { user, cart }
}

function formDataFrom(entries: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [key, value] of Object.entries(entries)) fd.append(key, value)
  return fd
}

beforeEach(() => {
  resetCookieJar()
  vi.mocked(issueReceipt).mockReset()
})

// ---------------------------------------------------------------------------
// 結帳計價
// ---------------------------------------------------------------------------

describe('結帳：組合價由伺服器重算並寫進訂單', () => {
  it('湊齊組合：訂單、付款、物流代收、發票、收據的金額一致，組合快照寫入', async () => {
    const top = await createTestProduct({ price: 1200, stock: 5 })
    const pants = await createTestProduct({ price: 900, stock: 5 })
    const bundle = await createBundle({
      name: '上衣褲子組',
      price: 1800,
      items: [{ productId: top.product.id }, { productId: pants.product.id }],
    })
    await memberWithCart([
      { variantId: top.variants[0]!.id, qty: 1 },
      { variantId: pants.variants[0]!.id, qty: 1 },
    ])

    const result = await createOrderFromCart(orderInput())
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const order = await db.order.findUniqueOrThrow({
      where: { id: result.orderId },
      include: { bundles: true, payments: true, shipment: true, invoice: true, receipt: true },
    })
    // 原價 2100 → 組合價 1800，省 300；1800 達免運門檻
    expect(order.subtotal).toBe(2100)
    expect(order.bundleDiscount).toBe(300)
    expect(order.discountTotal).toBe(0)
    expect(order.shippingFee).toBe(1800 >= FREE_THRESHOLD ? 0 : HOME_FEE)
    expect(order.grandTotal).toBe(1800 + order.shippingFee)
    expect(order.bundles).toEqual([
      expect.objectContaining({
        bundleId: bundle.id,
        name: '上衣褲子組',
        sets: 1,
        price: 1800,
        originalTotal: 2100,
        discount: 300,
      }),
    ])
    // 綠界收的金額 = 訂單應付
    expect(order.payments[0]!.amount).toBe(order.grandTotal)
    expect(order.shipment!.goodsAmount).toBe(order.grandTotal)
    expect(order.invoice!.amount).toBe(order.grandTotal)
    expect(order.receipt!.amount).toBe(order.grandTotal)
  })

  it('庫存逐件預扣：組合裡的每個規格各自佔住庫存', async () => {
    const top = await createTestProduct({ price: 1000, stock: 3 })
    const pants = await createTestProduct({ price: 800, stock: 3 })
    await createBundle({
      price: 1500,
      items: [{ productId: top.product.id }, { productId: pants.product.id, qty: 2 }],
    })
    await memberWithCart([
      { variantId: top.variants[0]!.id, qty: 1 },
      { variantId: pants.variants[0]!.id, qty: 2 },
    ])

    const result = await createOrderFromCart(orderInput())
    expect(result.ok).toBe(true)

    const [t, p] = await Promise.all([
      db.productVariant.findUniqueOrThrow({ where: { id: top.variants[0]!.id } }),
      db.productVariant.findUniqueOrThrow({ where: { id: pants.variants[0]!.id } }),
    ])
    expect(t.reservedStock).toBe(1)
    expect(p.reservedStock).toBe(2)
  })

  it('組合內某件庫存不足：整筆失敗、其他規格的預扣全部還回去', async () => {
    const top = await createTestProduct({ price: 1000, stock: 5 })
    const pants = await createTestProduct({ price: 800, stock: 0 })
    await createBundle({
      price: 1500,
      items: [{ productId: top.product.id }, { productId: pants.product.id }],
    })
    await memberWithCart([
      { variantId: top.variants[0]!.id, qty: 1 },
      { variantId: pants.variants[0]!.id, qty: 1 },
    ])

    const result = await createOrderFromCart(orderInput())
    expect(result.ok).toBe(false)
    const t = await db.productVariant.findUniqueOrThrow({ where: { id: top.variants[0]!.id } })
    expect(t.reservedStock).toBe(0)
    expect(await db.order.count()).toBe(0)
  })

  async function orderWithBundle() {
    const top = await createTestProduct({ price: 1000, stock: 4 })
    const pants = await createTestProduct({ price: 800, stock: 4 })
    await createBundle({
      price: 1500,
      items: [{ productId: top.product.id }, { productId: pants.product.id }],
    })
    await memberWithCart([
      { variantId: top.variants[0]!.id, qty: 1 },
      { variantId: pants.variants[0]!.id, qty: 1 },
    ])
    const result = await createOrderFromCart(orderInput())
    if (!result.ok) throw new Error(result.error)
    const order = await db.order.findUniqueOrThrow({
      where: { id: result.orderId },
      include: { payments: true },
    })
    return { order, payment: order.payments[0]!, top, pants }
  }

  it('付款回拋：綠界回報的是沒折組合價的原價 → 拒絕入帳', async () => {
    const { order, payment } = await orderWithBundle()

    await expect(
      handlePaymentReturn(
        signedPaymentReturnParams({ grandTotal: order.subtotal + order.shippingFee, payment }),
      ),
    ).rejects.toThrow('付款金額不符')
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'PENDING_PAYMENT',
    )
  })

  it('付款回拋：金額等於組合價後的應付金額 → 入帳，每個規格各自扣庫存', async () => {
    const { order, payment, top, pants } = await orderWithBundle()
    expect(payment.amount).toBe(order.grandTotal)

    await handlePaymentReturn(signedPaymentReturnParams({ grandTotal: order.grandTotal, payment }))
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PAID')

    const [t, p] = await Promise.all([
      db.productVariant.findUniqueOrThrow({ where: { id: top.variants[0]!.id } }),
      db.productVariant.findUniqueOrThrow({ where: { id: pants.variants[0]!.id } }),
    ])
    expect([t.stock, t.reservedStock]).toEqual([3, 0])
    expect([p.stock, p.reservedStock]).toEqual([3, 0])
  })

  it('與折扣碼並用：百分比折扣以組合價後的金額計算', async () => {
    const a = await createTestProduct({ price: 1500 })
    const b = await createTestProduct({ price: 1500 })
    await createBundle({
      price: 2400,
      items: [{ productId: a.product.id }, { productId: b.product.id }],
    })
    const coupon = await createTestCoupon({ type: 'PERCENT', value: 10 })
    await memberWithCart(
      [
        { variantId: a.variants[0]!.id, qty: 1 },
        { variantId: b.variants[0]!.id, qty: 1 },
      ],
      coupon.code,
    )

    const result = await createOrderFromCart(orderInput({ couponCode: coupon.code }))
    if (!result.ok) throw new Error(result.error)
    const order = await db.order.findUniqueOrThrow({ where: { id: result.orderId } })
    expect(order.subtotal).toBe(3000)
    expect(order.bundleDiscount).toBe(600)
    expect(order.discountTotal).toBe(240) // 2400 × 10%
    expect(order.grandTotal).toBe(3000 - 600 - 240 + order.shippingFee)
  })

  it('折扣碼的最低消費以組合價後的金額判斷', async () => {
    const a = await createTestProduct({ price: 1000 })
    const b = await createTestProduct({ price: 1000 })
    await createBundle({
      price: 1600,
      items: [{ productId: a.product.id }, { productId: b.product.id }],
    })
    // 原價 2000 夠、組合價 1600 不夠
    const coupon = await createTestCoupon({ type: 'FIXED', value: 100, minSubtotal: 1800 })
    await memberWithCart(
      [
        { variantId: a.variants[0]!.id, qty: 1 },
        { variantId: b.variants[0]!.id, qty: 1 },
      ],
      coupon.code,
    )

    const result = await createOrderFromCart(orderInput({ couponCode: coupon.code }))
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/消費滿/) })
  })

  it('下架的組合、組合裡有商品下架或規格停用：都不折價', async () => {
    const a = await createTestProduct({ price: 1000 })
    const b = await createTestProduct({ price: 1000, variantCount: 2 })
    const inactive = await createBundle({
      price: 1500,
      isActive: false,
      items: [{ productId: a.product.id }, { productId: b.product.id }],
    })
    const archivedOther = await createTestProduct({ price: 1000, status: 'ARCHIVED' })
    await createBundle({
      price: 1200,
      items: [{ productId: a.product.id }, { productId: archivedOther.product.id }],
    })
    const fixedVariant = await createBundle({
      price: 1500,
      items: [
        { productId: a.product.id },
        { productId: b.product.id, variantId: b.variants[1]!.id },
      ],
    })
    await db.productVariant.update({ where: { id: b.variants[1]!.id }, data: { isActive: false } })

    const lines = [
      { variantId: a.variants[0]!.id, qty: 1, variant: { productId: a.product.id, price: 1000 } },
      { variantId: b.variants[1]!.id, qty: 1, variant: { productId: b.product.id, price: 1100 } },
    ]
    expect((await matchCartBundles(lines)).discount).toBe(0)

    // 打開上架那個 → 才折價（任一規格）
    await db.bundle.update({ where: { id: inactive.id }, data: { isActive: true } })
    const matched = await matchCartBundles(lines)
    expect(matched.applied.map((m) => m.bundleId)).toEqual([inactive.id])
    expect(matched.applied.map((m) => m.bundleId)).not.toContain(fixedVariant.id)
  })

  it('金額取資料庫的現價：購物車建立後商品改價，下單以新價格計算', async () => {
    const a = await createTestProduct({ price: 1000 })
    const b = await createTestProduct({ price: 1000 })
    await createBundle({
      price: 1700,
      items: [{ productId: a.product.id }, { productId: b.product.id }],
    })
    await memberWithCart([
      { variantId: a.variants[0]!.id, qty: 1 },
      { variantId: b.variants[0]!.id, qty: 1 },
    ])
    await db.productVariant.update({ where: { id: a.variants[0]!.id }, data: { price: 1200 } })

    const result = await createOrderFromCart(orderInput())
    if (!result.ok) throw new Error(result.error)
    const order = await db.order.findUniqueOrThrow({ where: { id: result.orderId } })
    expect(order.subtotal).toBe(2200)
    expect(order.bundleDiscount).toBe(500)
  })

  it('收據：組合優惠是一個負數品項，品項加總等於收據金額', async () => {
    const a = await createTestProduct({ price: 900 })
    const b = await createTestProduct({ price: 900 })
    await createBundle({
      price: 1500,
      items: [{ productId: a.product.id }, { productId: b.product.id }],
    })
    await memberWithCart([
      { variantId: a.variants[0]!.id, qty: 1 },
      { variantId: b.variants[0]!.id, qty: 1 },
    ])
    const result = await createOrderFromCart(orderInput())
    if (!result.ok) throw new Error(result.error)
    await db.order.update({ where: { id: result.orderId }, data: { status: 'PAID' } })

    vi.mocked(issueReceipt).mockResolvedValue({ RtnCode: 1, RtnMsg: 'ok', ReceiptNo: 'R1' })
    await issueReceiptForOrder(result.orderId)

    const payload = vi.mocked(issueReceipt).mock.calls[0]![0]
    expect(payload.items).toContainEqual({ name: '組合優惠', count: 1, price: -300 })
    const sum = payload.items.reduce((s, i) => s + i.count * i.price, 0)
    expect(sum).toBe(payload.amount)
    expect(payload.amount).toBe(result.grandTotal)
  })
})

// ---------------------------------------------------------------------------
// 加入購物車
// ---------------------------------------------------------------------------

describe('addBundleToCart', () => {
  async function asGuest() {
    const anonId = `anon-bundle-${Date.now()}-${Math.random()}`
    getCookieJar().seed('sagon_cart', anonId)
    mockAuthUser(null)
    return anonId
  }

  it('一次把每個規格加進購物車，「任一規格」的項目可以選不同尺寸', async () => {
    const top = await createTestProduct({ price: 1000, variantCount: 3 })
    const pants = await createTestProduct({ price: 800 })
    const bundle = await createBundle({
      price: 2200,
      items: [
        { productId: top.product.id, qty: 2 },
        { productId: pants.product.id, variantId: pants.variants[0]!.id },
      ],
    })
    const anonId = await asGuest()
    const topItem = bundle.items.find((i) => i.productId === top.product.id)!

    const result = await addBundleToCart(bundle.id, [
      { itemId: topItem.id, variantIds: [top.variants[0]!.id, top.variants[2]!.id] },
    ])
    expect(result).toEqual({ ok: true, count: 3 })

    const cart = await db.cart.findUniqueOrThrow({ where: { anonId }, include: { items: true } })
    expect(Object.fromEntries(cart.items.map((i) => [i.variantId, i.qty]))).toEqual({
      [top.variants[0]!.id]: 1,
      [top.variants[2]!.id]: 1,
      [pants.variants[0]!.id]: 1,
    })
  })

  it('拿別件商品的規格冒充組合項目 → 拒絕，購物車不動', async () => {
    const top = await createTestProduct({ price: 1000 })
    const other = await createTestProduct({ price: 5000 })
    const bundle = await createBundle({ price: 800, items: [{ productId: top.product.id }] })
    await asGuest()

    const result = await addBundleToCart(bundle.id, [
      { itemId: bundle.items[0]!.id, variantIds: [other.variants[0]!.id] },
    ])
    expect(result.ok).toBe(false)
    expect(await db.cartItem.count()).toBe(0)
  })

  it('件數不對、下架的組合 → 拒絕', async () => {
    const top = await createTestProduct({ price: 1000 })
    const bundle = await createBundle({
      price: 1500,
      items: [{ productId: top.product.id, qty: 2 }],
    })
    await asGuest()

    const wrongCount = await addBundleToCart(bundle.id, [
      { itemId: bundle.items[0]!.id, variantIds: [top.variants[0]!.id] },
    ])
    expect(wrongCount.ok).toBe(false)

    await db.bundle.update({ where: { id: bundle.id }, data: { isActive: false } })
    const inactive = await addBundleToCart(bundle.id, [
      { itemId: bundle.items[0]!.id, variantIds: [top.variants[0]!.id, top.variants[0]!.id] },
    ])
    expect(inactive.ok).toBe(false)
    expect(await db.cartItem.count()).toBe(0)
  })

  it('庫存不夠整組：一件都不加', async () => {
    const top = await createTestProduct({ price: 1000, stock: 5 })
    const pants = await createTestProduct({ price: 800, stock: 1 })
    const bundle = await createBundle({
      price: 2000,
      items: [{ productId: top.product.id }, { productId: pants.product.id, qty: 2 }],
    })
    await asGuest()
    const pantsItem = bundle.items.find((i) => i.productId === pants.product.id)!
    const topItem = bundle.items.find((i) => i.productId === top.product.id)!

    const result = await addBundleToCart(bundle.id, [
      { itemId: topItem.id, variantIds: [top.variants[0]!.id] },
      { itemId: pantsItem.id, variantIds: [pants.variants[0]!.id, pants.variants[0]!.id] },
    ])
    expect(result.ok).toBe(false)
    expect(await db.cartItem.count()).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 前台顯示
// ---------------------------------------------------------------------------

describe('getStorefrontBundles', () => {
  it('回傳組合價、原價範圍與至少省多少；商品頁只列含該商品的組合', async () => {
    const top = await createTestProduct({ price: 1000, variantCount: 2 }) // 1000、1100
    const pants = await createTestProduct({ price: 800 })
    const robe = await createTestProduct({ price: 2000 })
    await createBundle({
      name: '上衣褲子組',
      price: 1500,
      items: [{ productId: top.product.id }, { productId: pants.product.id }],
    })
    await createBundle({
      name: '睡袍組',
      price: 3000,
      items: [{ productId: robe.product.id, qty: 2 }],
    })

    const all = await getStorefrontBundles('zh-TW')
    expect(all.map((b) => b.name)).toEqual(['上衣褲子組', '睡袍組'])
    expect(all[0]).toMatchObject({ price: 1500, originalMin: 1800, originalMax: 1900, saving: 300 })

    const forPants = await getStorefrontBundles('zh-TW', { productId: pants.product.id })
    expect(forPants.map((b) => b.name)).toEqual(['上衣褲子組'])
  })
})

// ---------------------------------------------------------------------------
// 後台
// ---------------------------------------------------------------------------

describe('後台組合管理', () => {
  let admin: User
  const INITIAL: BundleFormState = { ok: false }

  beforeEach(async () => {
    admin = await createTestUser({ role: 'ADMIN' })
    mockAuthUser({ id: admin.id, role: 'ADMIN' })
  })

  it('非管理員不能操作', async () => {
    mockAuthUser(null)
    await expect(
      saveBundle(INITIAL, formDataFrom({ name: 'x', price: '1', items: '[]' })),
    ).rejects.toThrow('FORBIDDEN')
    await expect(toggleBundle('x', true)).rejects.toThrow('FORBIDDEN')
  })

  it('建立組合：合併重複項目、寫入稽核紀錄、預設不上架', async () => {
    const top = await createTestProduct({ price: 1000 })
    const result = await saveBundle(
      INITIAL,
      formDataFrom({
        name: '兩件組',
        price: '1800',
        items: JSON.stringify([
          { productId: top.product.id, variantId: null, qty: 1 },
          { productId: top.product.id, variantId: '', qty: 1 },
        ]),
      }),
    )
    expect(result.ok).toBe(true)
    const bundle = await db.bundle.findFirstOrThrow({ include: { items: true } })
    expect(bundle).toMatchObject({ name: '兩件組', price: 1800, isActive: false, slug: '兩件組' })
    expect(bundle.items).toEqual([expect.objectContaining({ productId: top.product.id, qty: 2 })])
    expect(result.redirectTo).toBe(`/admin/bundles/${bundle.id}`)
    expect(
      await db.auditLog.count({ where: { action: 'bundle.create', entityId: bundle.id } }),
    ).toBe(1)
  })

  it('組合價不低於最便宜組法的原價 → 拒絕', async () => {
    const top = await createTestProduct({ price: 1000, variantCount: 2 }) // 1000、1100
    const result = await saveBundle(
      INITIAL,
      formDataFrom({
        name: '不划算',
        price: '1000',
        items: JSON.stringify([{ productId: top.product.id, qty: 1 }]),
      }),
    )
    expect(result.ok).toBe(false)
    expect(result.fieldErrors?.items).toMatch(/組合價必須低於原價合計/)
    expect(await db.bundle.count()).toBe(0)
  })

  it('指定的規格不屬於那件商品 → 拒絕', async () => {
    const top = await createTestProduct({ price: 1000 })
    const other = await createTestProduct({ price: 1000 })
    const result = await saveBundle(
      INITIAL,
      formDataFrom({
        name: '錯配',
        price: '500',
        items: JSON.stringify([
          { productId: top.product.id, variantId: other.variants[0]!.id, qty: 1 },
        ]),
      }),
    )
    expect(result.ok).toBe(false)
  })

  it('上架時重驗：組合裡有商品沒上架就不能上架', async () => {
    const draft = await createTestProduct({ price: 1000, status: 'DRAFT' })
    const bundle = await createBundle({
      price: 500,
      isActive: false,
      items: [{ productId: draft.product.id }],
    })

    const result = await toggleBundle(bundle.id, true)
    expect(result.ok).toBe(false)
    expect((await db.bundle.findUniqueOrThrow({ where: { id: bundle.id } })).isActive).toBe(false)

    await db.product.update({ where: { id: draft.product.id }, data: { status: 'ACTIVE' } })
    expect((await toggleBundle(bundle.id, true)).ok).toBe(true)
  })

  it('修改組合：內容整批替換', async () => {
    const a = await createTestProduct({ price: 1000 })
    const b = await createTestProduct({ price: 1000 })
    const bundle = await createBundle({ price: 900, items: [{ productId: a.product.id }] })

    const result = await saveBundle(
      INITIAL,
      formDataFrom({
        id: bundle.id,
        name: '改過的組合',
        price: '1700',
        isActive: 'on',
        items: JSON.stringify([
          { productId: a.product.id, qty: 1 },
          { productId: b.product.id, variantId: b.variants[0]!.id, qty: 1 },
        ]),
      }),
    )
    expect(result.ok).toBe(true)
    const saved = await db.bundle.findUniqueOrThrow({
      where: { id: bundle.id },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    })
    expect(saved).toMatchObject({
      name: '改過的組合',
      price: 1700,
      isActive: true,
      slug: bundle.slug,
    })
    expect(saved.items.map((i) => [i.productId, i.variantId])).toEqual([
      [a.product.id, null],
      [b.product.id, b.variants[0]!.id],
    ])
  })

  it('排序：上移下移後重寫 sortOrder', async () => {
    const p = await createTestProduct({ price: 1000 })
    const first = await createBundle({
      name: 'A',
      price: 500,
      sortOrder: 0,
      items: [{ productId: p.product.id }],
    })
    const second = await createBundle({
      name: 'B',
      price: 500,
      sortOrder: 0,
      items: [{ productId: p.product.id }],
    })

    expect((await moveBundle(second.id, 'up')).ok).toBe(true)
    const order = await db.bundle.findMany({ orderBy: { sortOrder: 'asc' }, select: { id: true } })
    expect(order.map((b) => b.id)).toEqual([second.id, first.id])
  })

  it('刪除組合：訂單上的組合快照保留', async () => {
    const a = await createTestProduct({ price: 900 })
    const b = await createTestProduct({ price: 900 })
    const bundle = await createBundle({
      price: 1500,
      items: [{ productId: a.product.id }, { productId: b.product.id }],
    })
    await memberWithCart([
      { variantId: a.variants[0]!.id, qty: 1 },
      { variantId: b.variants[0]!.id, qty: 1 },
    ])
    const order = await createOrderFromCart(orderInput())
    if (!order.ok) throw new Error(order.error)

    mockAuthUser({ id: admin.id, role: 'ADMIN' })
    expect((await deleteBundle(bundle.id)).ok).toBe(true)
    const snapshot = await db.orderBundle.findFirstOrThrow({ where: { orderId: order.orderId } })
    expect(snapshot).toMatchObject({ bundleId: null, discount: 300 })
  })

  it('組合用到的商品與規格不能直接刪除，訊息指出是哪個組合', async () => {
    const a = await createTestProduct({ price: 1000, variantCount: 2 })
    await createBundle({
      name: '擋刪組合',
      price: 500,
      items: [{ productId: a.product.id, variantId: a.variants[1]!.id }],
    })

    const delVariant = await deleteVariant(a.variants[1]!.id)
    expect(delVariant).toEqual({ ok: false, error: expect.stringContaining('擋刪組合') })
    const delProduct = await deleteProduct(a.product.id)
    expect(delProduct).toEqual({ ok: false, error: expect.stringContaining('擋刪組合') })
    expect(await db.product.count({ where: { id: a.product.id } })).toBe(1)
  })
})
