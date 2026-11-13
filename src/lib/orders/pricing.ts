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
  /**
   * 組合優惠折掉的金額（src/lib/bundles/match.ts 的 matchBundles 算出來的）。
   * 組合價先套，折扣碼的門檻、百分比與免運門檻都以扣掉組合優惠後的金額為準。
   */
  bundleDiscount?: number
  /**
   * 貨到付款手續費。只有選貨到付款時才傳。
   * 刻意與運費分開 —— 免運門檻不該把手續費也免掉（那是代收的成本，不是運費）。
   */
  codFee?: number
}

export interface PricingResult {
  /** 商品原價合計 */
  subtotal: number
  /** 組合優惠折掉的金額 */
  bundleDiscount: number
  /** 折扣碼折抵的金額 */
  discountTotal: number
  shippingFee: number
  codFee: number
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
  // 防呆：組合優惠不可能超過商品合計，也不會是負的
  const bundleDiscount = Math.min(subtotal, Math.max(0, Math.floor(input.bundleDiscount ?? 0)))
  // 套完組合價之後的商品金額 —— 折扣碼與免運門檻都看這個數字
  const merchandise = subtotal - bundleDiscount
  const baseShipping = input.shippingFees[input.shippingMethod] ?? 0

  let discountTotal = 0
  let couponFreeShipping = false
  let couponError: string | null = null

  if (input.coupon) {
    couponError = validateCoupon(input.coupon, merchandise)

    if (!couponError) {
      switch (input.coupon.type) {
        case 'PERCENT':
          // 無條件捨去到元，避免出現小數金額（綠界只收整數）
          discountTotal = Math.floor((merchandise * input.coupon.value) / 100)
          break
        case 'FIXED':
          // 折抵金額不能超過商品小計，否則會算出負數總額
          discountTotal = Math.min(input.coupon.value, merchandise)
          break
        case 'FREE_SHIPPING':
          couponFreeShipping = true
          break
      }
    }
  }

  const reachedThreshold = merchandise - discountTotal >= input.freeShippingThreshold
  const shippingFee = reachedThreshold || couponFreeShipping ? 0 : baseShipping

  const freeShippingReason = reachedThreshold
    ? ('threshold' as const)
    : couponFreeShipping
      ? ('coupon' as const)
      : null

  const codFee = Math.max(0, input.codFee ?? 0)

  return {
    subtotal,
    bundleDiscount,
    discountTotal,
    shippingFee,
    codFee,
    grandTotal: Math.max(0, merchandise - discountTotal + shippingFee + codFee),
    freeShippingReason: shippingFee === 0 ? freeShippingReason : null,
    couponError,
  }
}

/** 還差多少才免運。已達門檻回 0。 */
export function amountToFreeShipping(subtotal: number, threshold: number): number {
  return Math.max(0, threshold - subtotal)
}
