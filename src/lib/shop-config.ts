import 'server-only'
import { env } from '@/lib/env'

/** 商店層級的營運參數，集中一處方便後台日後改成 DB 設定。 */
export const shopConfig = {
  name: env.SHOP_NAME,
  taxId: env.SHOP_TAX_ID,
  shippingFee: {
    CVS: env.SHIPPING_FEE_CVS,
    HOME: env.SHIPPING_FEE_HOME,
  },
  freeShippingThreshold: env.FREE_SHIPPING_THRESHOLD,
  stockReservationMinutes: env.STOCK_RESERVATION_MINUTES,
} as const

export type ShippingMethodKey = keyof typeof shopConfig.shippingFee
