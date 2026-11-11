/**
 * 結帳時開放給客人選的物流通路。
 *
 * 與「系統認得的通路」分開：綠界 C2C 簽約有四家超商（見 lib/ecpay/logistics.ts 的
 * CVS_SUBTYPES），舊訂單也可能是萊爾富／OK，後台與物流回拋都還要認得它們；
 * 但購物說明（FAQ）只承諾 7-11、全家與黑貓宅急便，結帳就只開這幾個。
 *
 * 這個檔案前後台共用（結帳表單是 Client Component），不能 import server-only 的東西。
 */
export const CHECKOUT_CVS_SUBTYPES = ['UNIMARTC2C', 'FAMIC2C'] as const
export type CheckoutCvsSubType = (typeof CHECKOUT_CVS_SUBTYPES)[number]

export const CHECKOUT_HOME_SUBTYPES = ['TCAT'] as const

export function isCheckoutCvsSubType(value: string): value is CheckoutCvsSubType {
  return (CHECKOUT_CVS_SUBTYPES as readonly string[]).includes(value)
}
