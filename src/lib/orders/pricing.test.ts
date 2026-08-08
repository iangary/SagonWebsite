import { describe, it, expect } from 'vitest'
import type { Coupon } from '@prisma/client'
import { calculatePricing, validateCoupon, amountToFreeShipping } from './pricing'

const SHIPPING_FEES = { CVS: 60, HOME: 120 } as const
const THRESHOLD = 1500

function coupon(overrides: Partial<Coupon>): Coupon {
  return {
    id: 'c1',
    code: 'TEST',
    description: null,
    type: 'FIXED',
    value: 0,
    minSubtotal: 0,
    startsAt: null,
    endsAt: null,
    usageLimit: null,
    perUserLimit: 1,
    usedCount: 0,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function price(lines: { unitPrice: number; qty: number }[], opts: Partial<Parameters<typeof calculatePricing>[0]> = {}) {
  return calculatePricing({
    lines: lines.map((l, i) => ({ variantId: `v${i}`, ...l })),
    shippingMethod: 'CVS',
    shippingFees: SHIPPING_FEES,
    freeShippingThreshold: THRESHOLD,
    ...opts,
  })
}

describe('calculatePricing — 基本計算', () => {
  it('小計為單價乘數量後加總', () => {
    const r = price([
      { unitPrice: 1000, qty: 2 },
      { unitPrice: 300, qty: 1 },
    ])
    expect(r.subtotal).toBe(2300)
  })

  it('未達免運門檻時收取該配送方式的運費', () => {
    const r = price([{ unitPrice: 500, qty: 1 }])
    expect(r.shippingFee).toBe(60)
    expect(r.grandTotal).toBe(560)
  })

  it('宅配運費與超商不同', () => {
    const r = price([{ unitPrice: 500, qty: 1 }], { shippingMethod: 'HOME' })
    expect(r.shippingFee).toBe(120)
  })

  it('達到免運門檻就不收運費', () => {
    const r = price([{ unitPrice: 1500, qty: 1 }])
    expect(r.shippingFee).toBe(0)
    expect(r.freeShippingReason).toBe('threshold')
    expect(r.grandTotal).toBe(1500)
  })

  it('空購物車全部為 0', () => {
    const r = price([])
    expect(r.subtotal).toBe(0)
    expect(r.grandTotal).toBe(60)
  })
})

describe('calculatePricing — 折扣碼', () => {
  it('PERCENT 依百分比折抵並無條件捨去到元', () => {
    // 2333 的 10% = 233.3 → 233
    const r = price([{ unitPrice: 2333, qty: 1 }], {
      coupon: coupon({ type: 'PERCENT', value: 10 }),
    })
    expect(r.discountTotal).toBe(233)
    expect(r.grandTotal).toBe(2100)
  })

  it('FIXED 折抵固定金額', () => {
    const r = price([{ unitPrice: 1200, qty: 1 }], {
      coupon: coupon({ type: 'FIXED', value: 100 }),
    })
    expect(r.discountTotal).toBe(100)
    expect(r.grandTotal).toBe(1160) // 1200 - 100 = 1100 未達門檻，+60 運費
  })

  it('FIXED 折抵不會超過小計，總額不會變成負數', () => {
    const r = price([{ unitPrice: 200, qty: 1 }], {
      coupon: coupon({ type: 'FIXED', value: 5000 }),
    })
    expect(r.discountTotal).toBe(200)
    expect(r.grandTotal).toBe(60)
  })

  it('FREE_SHIPPING 免運但不折商品金額', () => {
    const r = price([{ unitPrice: 800, qty: 1 }], {
      coupon: coupon({ type: 'FREE_SHIPPING' }),
    })
    expect(r.discountTotal).toBe(0)
    expect(r.shippingFee).toBe(0)
    expect(r.freeShippingReason).toBe('coupon')
    expect(r.grandTotal).toBe(800)
  })

  it('免運門檻是看折扣後的金額，不是原始小計', () => {
    // 小計 1600 達門檻，但折 200 後剩 1400 就不到了
    const r = price([{ unitPrice: 1600, qty: 1 }], {
      coupon: coupon({ type: 'FIXED', value: 200 }),
    })
    expect(r.shippingFee).toBe(60)
    expect(r.grandTotal).toBe(1460)
  })

  it('折扣碼不符條件時不折抵，並回傳錯誤訊息', () => {
    const r = price([{ unitPrice: 500, qty: 1 }], {
      coupon: coupon({ type: 'FIXED', value: 100, minSubtotal: 1000 }),
    })
    expect(r.discountTotal).toBe(0)
    expect(r.couponError).toContain('1,000')
    expect(r.grandTotal).toBe(560)
  })
})

describe('validateCoupon', () => {
  const now = new Date('2026-06-15T00:00:00Z')

  it('停用的折扣碼不能用', () => {
    expect(validateCoupon(coupon({ isActive: false }), 1000, now)).toBe('折扣碼已停用')
  })

  it('尚未開始的不能用', () => {
    expect(validateCoupon(coupon({ startsAt: new Date('2026-07-01') }), 1000, now)).toBe(
      '折扣碼尚未開始',
    )
  })

  it('已過期的不能用', () => {
    expect(validateCoupon(coupon({ endsAt: new Date('2026-06-01') }), 1000, now)).toBe(
      '折扣碼已過期',
    )
  })

  it('用完次數的不能用', () => {
    expect(validateCoupon(coupon({ usageLimit: 10, usedCount: 10 }), 1000, now)).toBe(
      '折扣碼已被兌換完畢',
    )
  })

  it('條件都符合時回 null', () => {
    expect(validateCoupon(coupon({ minSubtotal: 500 }), 1000, now)).toBeNull()
  })
})

describe('amountToFreeShipping', () => {
  it('回傳還差多少', () => {
    expect(amountToFreeShipping(1200, 1500)).toBe(300)
  })

  it('已達門檻回 0', () => {
    expect(amountToFreeShipping(1800, 1500)).toBe(0)
  })
})
