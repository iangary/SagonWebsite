import 'server-only'
import { env } from '@/lib/env'
import { pickLocalized } from '@/lib/i18n/localized'

/** 商店層級的營運參數，集中一處方便後台日後改成 DB 設定。 */
export const shopConfig = {
  name: env.SHOP_NAME,
  nameEn: env.SHOP_NAME_EN,
  taxId: env.SHOP_TAX_ID,
  shippingFee: {
    CVS: env.SHIPPING_FEE_CVS,
    HOME: env.SHIPPING_FEE_HOME,
  },
  freeShippingThreshold: env.FREE_SHIPPING_THRESHOLD,
  stockReservationMinutes: env.STOCK_RESERVATION_MINUTES,
} as const

export type ShippingMethodKey = keyof typeof shopConfig.shippingFee

/**
 * 依語系挑店名。前台的 logo、頁尾、關於頁與 metadata 都走這裡，
 * 才不會出現「英文頁的 logo 是中文、旁邊的版權宣告卻是英文」。
 */
export function shopName(locale: string): string {
  return pickLocalized(locale, shopConfig.name, shopConfig.nameEn)
}
