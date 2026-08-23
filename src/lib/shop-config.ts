import 'server-only'
import { env } from '@/lib/env'
import { pickLocalized } from '@/lib/i18n/localized'

/** 商店層級的營運參數，集中一處方便後台日後改成 DB 設定。 */
export const shopConfig = {
  name: env.SHOP_NAME,
  nameEn: env.SHOP_NAME_EN,
  taxId: env.SHOP_TAX_ID,
  serviceEmail: env.SHOP_SERVICE_EMAIL,
  shippingFee: {
    CVS: env.SHIPPING_FEE_CVS,
    HOME: env.SHIPPING_FEE_HOME,
  },
  freeShippingThreshold: env.FREE_SHIPPING_THRESHOLD,
  stockReservationMinutes: env.STOCK_RESERVATION_MINUTES,
} as const

export type ShippingMethodKey = keyof typeof shopConfig.shippingFee

/**
 * LINE 官方帳號（退款與退換貨的客服入口）。
 *
 * 沒設定 SHOP_LINE_URL 時回 null，呼叫端要退回顯示客服信箱 ——
 * 給客人一顆點了沒反應的「加 LINE 客服」按鈕比沒有這顆按鈕更糟。
 */
export const lineSupport: { url: string; id: string | null } | null = env.SHOP_LINE_URL
  ? { url: env.SHOP_LINE_URL, id: env.SHOP_LINE_ID || null }
  : null

/**
 * 依語系挑店名。前台的 logo、頁尾、關於頁與 metadata 都走這裡，
 * 才不會出現「英文頁的 logo 是中文、旁邊的版權宣告卻是英文」。
 */
export function shopName(locale: string): string {
  return pickLocalized(locale, shopConfig.name, shopConfig.nameEn)
}
