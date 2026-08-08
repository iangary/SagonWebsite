import type { Coupon, ShippingMethod } from '@prisma/client'

/**
 * 訂單金額計算。
 *
 * 刻意寫成不碰 DB 的純函式，這樣購物車、結帳、後台三處可以共用同一份邏輯，
 * 也才能直接寫單元測試涵蓋各種折扣組合。
 */

export interface PricingLine {
  variantId: string
  unitPrice: number
  qty: number
}

export interface PricingInput {
  lines: PricingLine[]
  shippingMethod: ShippingMethod
  shippingFees: Record<ShippingMethod, number>
  freeShippingThreshold: number
  coupon?: Coupon | null
}

export interface PricingResult {
  subtotal: number
  discountTotal: number
  shippingFee: number
  grandTotal: number
  /** 免運是門檻達成還是折扣碼給的，前台顯示的文案不一樣 */
  freeShippingReason: 'threshold' | 'coupon' | null
  couponError: string | null
}

export function calculateSubtotal(lines: PricingLine[]): number {
  return lines.reduce((sum, line) => sum + line.unitPrice * line.qty, 0)
}

/**
 * 檢查折扣碼在這張訂單上能不能用。
 * 回傳錯誤字串代表不能用；null 代表通過。
 * 使用次數上限由 applyCouponUsage() 在成立訂單的 transaction 裡再檢查一次。
 */
export function validateCoupon(coupon: Coupon, subtotal: number, now = new Date()): string | null {
  if (!coupon.isActive) return '折扣碼已停用'
  if (coupon.startsAt && coupon.startsAt > now) return '折扣碼尚未開始'
  if (coupon.endsAt && coupon.endsAt < now) return '折扣碼已過期'
  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
    return '折扣碼已被兌換完畢'
  }
  if (subtotal < coupon.minSubtotal) {
    return `消費滿 NT$${coupon.minSubtotal.toLocaleString('zh-TW')} 才能使用這張折扣碼`
  }
  return null
}

export function calculatePricing(input: PricingInput): PricingResult {
  const subtotal = calculateSubtotal(input.lines)
  const baseShipping = input.shippingFees[input.shippingMethod] ?? 0

  let discountTotal = 0
  let couponFreeShipping = false
  let couponError: string | null = null

  if (input.coupon) {
    couponError = validateCoupon(input.coupon, subtotal)

    if (!couponError) {
      switch (input.coupon.type) {
        case 'PERCENT':
          // 無條件捨去到元，避免出現小數金額（綠界只收整數）
          discountTotal = Math.floor((subtotal * input.coupon.value) / 100)
          break
        case 'FIXED':
          // 折抵金額不能超過商品小計，否則會算出負數總額
          discountTotal = Math.min(input.coupon.value, subtotal)
          break
        case 'FREE_SHIPPING':
          couponFreeShipping = true
          break
      }
    }
  }

  const reachedThreshold = subtotal - discountTotal >= input.freeShippingThreshold
  const shippingFee = reachedThreshold || couponFreeShipping ? 0 : baseShipping

  const freeShippingReason = reachedThreshold
    ? ('threshold' as const)
    : couponFreeShipping
      ? ('coupon' as const)
      : null

  return {
    subtotal,
    discountTotal,
    shippingFee,
    grandTotal: Math.max(0, subtotal - discountTotal + shippingFee),
    freeShippingReason: shippingFee === 0 ? freeShippingReason : null,
    couponError,
  }
}

/** 還差多少才免運。已達門檻回 0。 */
export function amountToFreeShipping(subtotal: number, threshold: number): number {
  return Math.max(0, threshold - subtotal)
}
