import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/queue', async () => (await import('./mocks')).queueMockModule())
vi.mock('@/lib/auth', async () => (await import('./mocks')).authMockModule())
vi.mock('next/headers', async () => (await import('./mocks')).nextHeadersMockModule())
vi.mock('next/cache', async () => (await import('./mocks')).nextCacheMockModule())

import { db } from '@/lib/db'
import { createOrderFromCart, type CreateOrderInput, type CreateOrderResult } from '@/lib/orders/create'
import {
  createTestCart,
  createTestCoupon,
  createTestOrder,
  createTestProduct,
  createTestUser,
  reloadOrder,
} from '../factories'
import { MemoryCookieJar, enqueueMock, getCookieJar, mockAuthUser, resetCookieJar, withCookieJar } from './mocks'

/**
 * createOrderFromCart 的整合測試 —— 從購物車到完整訂單的全鏈路。
 *
 * 購物車靠 sagon_cart cookie（值就是 anonId）認人，這裡用記憶體
 * cookie jar 餵給 next/headers 的 mock；併發測試各自帶自己的 jar。
 */

let anonSeq = 0

/** 建一台訪客購物車，並把 anonId 種進「目前的」cookie jar */
async function seedGuestCart(
  items: Array<{ variantId: string; qty: number }>,
  opts: { couponCode?: string; jar?: MemoryCookieJar } = {},
) {
  anonSeq += 1
  const anonId = `test-anon-${Date.now()}-${anonSeq}`
  const cart = await createTestCart({ anonId, items, couponCode: opts.couponCode })
  ;(opts.jar ?? getCookieJar()).seed('sagon_cart', anonId)
  return cart
}

function baseInput(overrides: Partial<CreateOrderInput> = {}): CreateOrderInput {
  return {
    email: 'buyer@test.local',
    phone: '0912345678',
    recipientName: '測試買家',
    recipientPhone: '0987654321',
    shippingMethod: 'CVS',
    logisticsSubType: 'UNIMARTC2C',
    cvsStoreId: '131386',
    cvsStoreName: '測試門市',
    cvsAddress: '台北市中山區南京東路一段 1 號',
    cvsTelephone: '0227112711',
    choosePayment: 'Credit',
    invoice: { isB2B: false },
    ...overrides,
  }
}

function homeInput(overrides: Partial<CreateOrderInput> = {}): CreateOrderInput {
  return baseInput({
    shippingMethod: 'HOME',
    logisticsSubType: 'TCAT',
    cvsStoreId: undefined,
    cvsStoreName: undefined,
    cvsAddress: undefined,
    cvsTelephone: undefined,
    addressZip: '104',
    addressCity: '台北市',
    addressDistrict: '中山區',
    addressLine: '南京東路 1 號',
    ...overrides,
  })
}

function assertOk(result: CreateOrderResult): Extract<CreateOrderResult, { ok: true }> {
  if (!result.ok) throw new Error(`預期下單成功，卻失敗：${result.error}`)
  return result
}

function assertFail(result: CreateOrderResult): Extract<CreateOrderResult, { ok: false }> {
  if (result.ok) throw new Error('預期下單失敗，卻成功了')
  return result
}

async function freshVariant(id: string) {
  return db.productVariant.findUniqueOrThrow({ where: { id } })
}

beforeEach(() => {
  resetCookieJar()
  mockAuthUser(null)
  enqueueMock.mockClear()
})

describe('createOrderFromCart — happy path', () => {
  it('CVS：建立完整訂單（快照/付款/物流/發票/收據/預扣）並清空購物車', async () => {
    const { product, variants } = await createTestProduct({ price: 500, stock: 10 })
    const cart = await seedGuestCart([{ variantId: variants[0].id, qty: 2 }], {
      couponCode: 'LEFTOVER',
    })

    const before = Date.now()
    const result = assertOk(await createOrderFromCart(baseInput({ choosePayment: 'CVS' })))

    // 1000 未達免運門檻（1500）→ 超商運費 60
    expect(result.grandTotal).toBe(1060)

    const order = await reloadOrder(result.orderId)
    expect(order.orderNo).toBe(result.orderNo)
    expect(order.orderNo).toMatch(/^[A-Z0-9]{1,20}$/)
    expect(order.status).toBe('PENDING_PAYMENT')
    expect(order.subtotal).toBe(1000)
    expect(order.shippingFee).toBe(60)
    expect(order.grandTotal).toBe(1060)

    // 商品快照
    expect(order.items).toHaveLength(1)
    expect(order.items[0].productName).toBe(product.name)
    expect(order.items[0].variantName).toBe('單一規格')
    expect(order.items[0].sku).toBe(variants[0].sku)
    expect(order.items[0].unitPrice).toBe(500)
    expect(order.items[0].qty).toBe(2)
    expect(order.items[0].lineTotal).toBe(1000)
    expect(order.items[0].imageUrl).not.toBeNull()

    // 付款：merchantTradeNo = orderNo，僅英數且不超過 20 碼
    expect(order.payment?.status).toBe('PENDING')
    expect(order.payment?.merchantTradeNo).toBe(order.orderNo)
    expect(order.payment?.merchantTradeNo).toMatch(/^[A-Z0-9]{1,20}$/)
    expect(order.payment?.choosePayment).toBe('CVS')
    expect(order.payment?.amount).toBe(1060)

    // 物流：超商門市欄位
    expect(order.shipment?.logisticsType).toBe('CVS')
    expect(order.shipment?.logisticsSubType).toBe('UNIMARTC2C')
    expect(order.shipment?.cvsStoreId).toBe('131386')
    expect(order.shipment?.cvsStoreName).toBe('測試門市')
    expect(order.shipment?.cvsAddress).toBe('台北市中山區南京東路一段 1 號')
    expect(order.shipment?.receiverName).toBe('測試買家')
    expect(order.shipment?.receiverCell).toBe('0987654321')
    expect(order.shipment?.receiverAddress).toBeNull()
    expect(order.shipment?.status).toBe('PENDING')

    // 發票（人工）與電子收據都先建 PENDING 紀錄
    expect(order.invoice?.status).toBe('PENDING')
    expect(order.invoice?.amount).toBe(1060)
    expect(order.receipt?.status).toBe('PENDING')
    expect(order.receipt?.amount).toBe(1060)

    // 預扣：CVS 付款 → 30 分鐘（STOCK_RESERVATION_MINUTES 預設）
    expect(order.reservations).toHaveLength(1)
    expect(order.reservations[0].qty).toBe(2)
    const minutes = (order.reservations[0].expiresAt.getTime() - before) / 60_000
    expect(minutes).toBeGreaterThan(28)
    expect(minutes).toBeLessThan(32)
    expect((await freshVariant(variants[0].id)).reservedStock).toBe(2)

    // 購物車清空、殘留的折扣碼一併清掉
    expect(await db.cartItem.count({ where: { cartId: cart.id } })).toBe(0)
    const freshCart = await db.cart.findUniqueOrThrow({ where: { id: cart.id } })
    expect(freshCart.couponCode).toBeNull()
  })

  it('ATM：預扣有效期對齊綠界實際期限 ≈ 1 天（F1 修復後行為）', async () => {
    const { variants } = await createTestProduct({ stock: 10 })
    await seedGuestCart([{ variantId: variants[0].id, qty: 1 }])

    const before = Date.now()
    const result = assertOk(await createOrderFromCart(baseInput({ choosePayment: 'ATM' })))

    const order = await reloadOrder(result.orderId)
    const minutes = (order.reservations[0].expiresAt.getTime() - before) / 60_000
    expect(minutes).toBeGreaterThan(1438) // 不是 30 分鐘
    expect(minutes).toBeLessThan(1442)
  })

  it('HOME：addressLine 與 receiverAddress 正確組合，物流走宅配', async () => {
    const { variants } = await createTestProduct({ stock: 10 })
    await seedGuestCart([{ variantId: variants[0].id, qty: 1 }])

    const result = assertOk(await createOrderFromCart(homeInput()))

    const order = await reloadOrder(result.orderId)
    expect(order.shippingMethod).toBe('HOME')
    expect(order.addressZip).toBe('104')
    expect(order.addressCity).toBe('台北市')
    // 訂單存「區 + 路段」，city 另存一欄
    expect(order.addressLine).toBe('中山區南京東路 1 號')
    expect(order.shippingFee).toBe(120)

    expect(order.shipment?.logisticsType).toBe('HOME')
    expect(order.shipment?.logisticsSubType).toBe('TCAT')
    // 出貨單存完整地址「市 + 區 + 路段」
    expect(order.shipment?.receiverAddress).toBe('台北市中山區南京東路 1 號')
    expect(order.shipment?.receiverZip).toBe('104')
    expect(order.shipment?.cvsStoreId).toBeNull()
  })

  it('訪客下單 userId 為 null；登入會員下單綁 userId', async () => {
    const { variants } = await createTestProduct({ stock: 10 })
    await seedGuestCart([{ variantId: variants[0].id, qty: 1 }])
    const guestResult = assertOk(await createOrderFromCart(baseInput()))
    const guestOrder = await reloadOrder(guestResult.orderId)
    expect(guestOrder.userId).toBeNull()

    const user = await createTestUser()
    mockAuthUser({ id: user.id, role: 'CUSTOMER' })
    await createTestCart({ userId: user.id, items: [{ variantId: variants[0].id, qty: 1 }] })
    const memberResult = assertOk(await createOrderFromCart(baseInput()))
    const memberOrder = await reloadOrder(memberResult.orderId)
    expect(memberOrder.userId).toBe(user.id)
  })

  it('金額一致性：grandTotal 貫穿付款/物流/收據，達免運門檻運費為 0', async () => {
    // 800 x 2 = 1600 ≥ FREE_SHIPPING_THRESHOLD(1500) → 免運
    const { variants } = await createTestProduct({ price: 800, stock: 10 })
    await seedGuestCart([{ variantId: variants[0].id, qty: 2 }])

    const result = assertOk(await createOrderFromCart(baseInput()))

    const order = await reloadOrder(result.orderId)
    expect(order.shippingFee).toBe(0)
    expect(order.grandTotal).toBe(1600)
    expect(order.payment?.amount).toBe(1600)
    expect(order.shipment?.goodsAmount).toBe(1600)
    expect(order.receipt?.amount).toBe(1600)
    expect(order.invoice?.amount).toBe(1600)
  })

  it('email 一律轉小寫存入', async () => {
    const { variants } = await createTestProduct({ stock: 10 })
    await seedGuestCart([{ variantId: variants[0].id, qty: 1 }])

    const result = assertOk(
      await createOrderFromCart(baseInput({ email: 'Buyer@TEST.Local' })),
    )

    const order = await reloadOrder(result.orderId)
    expect(order.email).toBe('buyer@test.local')
  })
})

describe('createOrderFromCart — 前置檢查失敗', () => {
  it('空購物車直接失敗', async () => {
    await seedGuestCart([])

    const result = assertFail(await createOrderFromCart(baseInput()))
    expect(result.error).toBe('購物車是空的')
    expect(await db.order.count()).toBe(0)
  })

  it('變體已停用（isActive=false）：回「已下架」且無任何寫入', async () => {
    const { product, variants } = await createTestProduct({ isActiveVariant: false })
    await seedGuestCart([{ variantId: variants[0].id, qty: 1 }])

    const result = assertFail(await createOrderFromCart(baseInput()))
    expect(result.error).toBe(`「${product.name}」已下架，請從購物車移除`)
    expect(await db.order.count()).toBe(0)
    expect((await freshVariant(variants[0].id)).reservedStock).toBe(0)
  })

  it('商品是草稿（DRAFT）：同樣視為已下架', async () => {
    const { product, variants } = await createTestProduct({ status: 'DRAFT' })
    await seedGuestCart([{ variantId: variants[0].id, qty: 1 }])

    const result = assertFail(await createOrderFromCart(baseInput()))
    expect(result.error).toBe(`「${product.name}」已下架，請從購物車移除`)
    expect(await db.order.count()).toBe(0)
  })

  it('庫存不足：回錯誤、無訂單、reservedStock 不變', async () => {
    const { product, variants } = await createTestProduct({ stock: 2 })
    await seedGuestCart([{ variantId: variants[0].id, qty: 3 }])

    const result = assertFail(await createOrderFromCart(baseInput()))
    expect(result.error).toBe(`「${product.name} 單一規格」庫存不足，請調整數量`)
    expect(await db.order.count()).toBe(0)
    expect((await freshVariant(variants[0].id)).reservedStock).toBe(0)
  })

  it('部分預扣回滾：第二件庫存不足時，第一件的預扣也要回到原值', async () => {
    const { variants: okVariants } = await createTestProduct({ stock: 10 })
    const { variants: shortVariants } = await createTestProduct({ stock: 1 })
    const cart = await seedGuestCart([
      { variantId: okVariants[0].id, qty: 1 },
      { variantId: shortVariants[0].id, qty: 5 },
    ])

    const result = assertFail(await createOrderFromCart(baseInput()))
    expect(result.error).toContain('庫存不足')

    // 整筆交易回滾：沒有訂單、沒有預扣紀錄、兩個變體的 reservedStock 都是 0
    expect(await db.order.count()).toBe(0)
    expect(await db.stockReservation.count()).toBe(0)
    expect((await freshVariant(okVariants[0].id)).reservedStock).toBe(0)
    expect((await freshVariant(shortVariants[0].id)).reservedStock).toBe(0)
    // 購物車沒有被清空
    expect(await db.cartItem.count({ where: { cartId: cart.id } })).toBe(2)
  })
})

describe('createOrderFromCart — 折扣碼', () => {
  it('折扣碼 happy path：discountTotal 正確、usedCount+1、建立兌換紀錄', async () => {
    const coupon = await createTestCoupon({ code: 'SAVE100', type: 'FIXED', value: 100 })
    const { variants } = await createTestProduct({ price: 500, stock: 10 })
    await seedGuestCart([{ variantId: variants[0].id, qty: 2 }])

    const result = assertOk(await createOrderFromCart(baseInput({ couponCode: 'SAVE100' })))

    const order = await reloadOrder(result.orderId)
    expect(order.discountTotal).toBe(100)
    // 1000 - 100 = 900 未達免運 → +60
    expect(order.grandTotal).toBe(960)
    expect(order.couponId).toBe(coupon.id)

    const freshCoupon = await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })
    expect(freshCoupon.usedCount).toBe(1)

    const redemption = await db.couponRedemption.findUniqueOrThrow({
      where: { orderId: order.id },
    })
    expect(redemption.couponId).toBe(coupon.id)
    expect(redemption.userId).toBeNull() // 訪客兌換
  })

  it('過期 / 未生效 / 停用的折扣碼都被擋下且不建訂單', async () => {
    const { variants } = await createTestProduct({ stock: 10 })
    await seedGuestCart([{ variantId: variants[0].id, qty: 1 }])

    await createTestCoupon({ code: 'EXPIRED1', endsAt: new Date(Date.now() - 60_000) })
    const r1 = assertFail(await createOrderFromCart(baseInput({ couponCode: 'EXPIRED1' })))
    expect(r1.error).toBe('折扣碼已過期')

    await createTestCoupon({ code: 'NOTYET1', startsAt: new Date(Date.now() + 60 * 60_000) })
    const r2 = assertFail(await createOrderFromCart(baseInput({ couponCode: 'NOTYET1' })))
    expect(r2.error).toBe('折扣碼尚未開始')

    await createTestCoupon({ code: 'DISABLED1', isActive: false })
    const r3 = assertFail(await createOrderFromCart(baseInput({ couponCode: 'DISABLED1' })))
    expect(r3.error).toBe('折扣碼已停用')

    expect(await db.order.count()).toBe(0)
    expect((await freshVariant(variants[0].id)).reservedStock).toBe(0)
  })

  it('會員已達 perUserLimit：擋下', async () => {
    const user = await createTestUser()
    mockAuthUser({ id: user.id, role: 'CUSTOMER' })

    const coupon = await createTestCoupon({ code: 'ONCEONLY', perUserLimit: 1 })
    // 先前已兌換過一次（掛在一張既有訂單上）
    const prior = await createTestOrder({ userId: user.id, withReservations: false })
    await db.couponRedemption.create({
      data: { couponId: coupon.id, userId: user.id, orderId: prior.order.id },
    })

    const { variants } = await createTestProduct({ stock: 10 })
    await createTestCart({ userId: user.id, items: [{ variantId: variants[0].id, qty: 1 }] })

    const result = assertFail(await createOrderFromCart(baseInput({ couponCode: 'ONCEONLY' })))
    expect(result.error).toBe('您已達到這張折扣碼的使用次數上限')
    expect(await db.order.count()).toBe(1) // 只有事先建的那張
  })

  it('確定性用罄：usedCount 已達 usageLimit 直接被 validateCoupon 擋下', async () => {
    await createTestCoupon({ code: 'USEDUP', usageLimit: 2, usedCount: 2 })
    const { variants } = await createTestProduct({ stock: 10 })
    await seedGuestCart([{ variantId: variants[0].id, qty: 1 }])

    const result = assertFail(await createOrderFromCart(baseInput({ couponCode: 'USEDUP' })))
    expect(result.error).toBe('折扣碼已被兌換完畢')
    expect(await db.order.count()).toBe(0)

    const coupon = await db.coupon.findUniqueOrThrow({ where: { code: 'USEDUP' } })
    expect(coupon.usedCount).toBe(2) // 沒有被多加
  })

  it('折扣碼用罄競態：兩個訪客同時搶最後一次兌換，恰一個成功、輸家預扣回滾', async () => {
    const coupon = await createTestCoupon({ code: 'LASTONE', usageLimit: 1, value: 100 })
    const { variants: variantsA } = await createTestProduct({ stock: 10 })
    const { variants: variantsB } = await createTestProduct({ stock: 10 })

    const jarA = new MemoryCookieJar()
    const jarB = new MemoryCookieJar()
    await seedGuestCart([{ variantId: variantsA[0].id, qty: 1 }], { jar: jarA })
    await seedGuestCart([{ variantId: variantsB[0].id, qty: 1 }], { jar: jarB })

    const results = await Promise.all([
      withCookieJar(jarA, () => createOrderFromCart(baseInput({ couponCode: 'LASTONE' }))),
      withCookieJar(jarB, () => createOrderFromCart(baseInput({ couponCode: 'LASTONE' }))),
    ])

    expect(results.filter((r) => r.ok)).toHaveLength(1)
    const loser = assertFail(results.find((r) => !r.ok)!)
    expect(loser.error).toBe('折扣碼剛好被兌換完了，請移除後再試一次')

    // 只有贏家的訂單與預扣存在，輸家整筆回滾
    expect(await db.order.count()).toBe(1)
    const reservedA = (await freshVariant(variantsA[0].id)).reservedStock
    const reservedB = (await freshVariant(variantsB[0].id)).reservedStock
    expect(reservedA + reservedB).toBe(1)

    const freshCoupon = await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })
    expect(freshCoupon.usedCount).toBe(1)
    expect(await db.couponRedemption.count()).toBe(1)
  })
})

describe('createOrderFromCart — 全鏈搶庫存（C-02）', () => {
  it('庫存只剩 1，兩個訪客同時下單：恰一個成功、訂單恰一筆、reservedStock=1', async () => {
    const { variants } = await createTestProduct({ stock: 1 })

    const jarA = new MemoryCookieJar()
    const jarB = new MemoryCookieJar()
    await seedGuestCart([{ variantId: variants[0].id, qty: 1 }], { jar: jarA })
    await seedGuestCart([{ variantId: variants[0].id, qty: 1 }], { jar: jarB })

    const results = await Promise.all([
      withCookieJar(jarA, () => createOrderFromCart(baseInput())),
      withCookieJar(jarB, () => createOrderFromCart(baseInput())),
    ])

    expect(results.filter((r) => r.ok)).toHaveLength(1)
    const loser = assertFail(results.find((r) => !r.ok)!)
    expect(loser.error).toContain('庫存不足')

    expect(await db.order.count()).toBe(1)
    expect(await db.stockReservation.count()).toBe(1)
    const v = await freshVariant(variants[0].id)
    expect(v.reservedStock).toBe(1) // 絕不能是 2
    expect(v.stock).toBe(1) // 尚未付款，stock 不動
  })
})
