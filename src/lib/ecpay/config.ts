import 'server-only'
import { env } from '@/lib/env'
import type { EcpayCredentials } from './checkmac'

/**
 * 綠界三個服務各有自己的商店代號與端點，測試站與正式站也不同。
 * 全部集中在這裡，程式其他地方不要出現任何硬編的網址或金鑰。
 */

const IS_STAGE = env.ECPAY_ENV === 'stage'

export const ecpayEndpoints = {
  /** 全方位金流：導向綠界收銀台 */
  aioCheckout: IS_STAGE
    ? 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5'
    : 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5',
  /** 查詢訂單付款狀態 */
  queryTradeInfo: IS_STAGE
    ? 'https://payment-stage.ecpay.com.tw/Cashier/QueryTradeInfo/V5'
    : 'https://payment.ecpay.com.tw/Cashier/QueryTradeInfo/V5',
  /** 信用卡退刷 / 取消授權 */
  creditDetailDoAction: IS_STAGE
    ? 'https://payment-stage.ecpay.com.tw/CreditDetail/DoAction'
    : 'https://payment.ecpay.com.tw/CreditDetail/DoAction',

  /** 物流電子地圖（選擇超商門市） */
  logisticsMap: IS_STAGE
    ? 'https://logistics-stage.ecpay.com.tw/Express/map'
    : 'https://logistics.ecpay.com.tw/Express/map',
  /** 建立物流訂單 */
  logisticsCreate: IS_STAGE
    ? 'https://logistics-stage.ecpay.com.tw/Express/Create'
    : 'https://logistics.ecpay.com.tw/Express/Create',
  /** 查詢物流訂單 */
  logisticsQuery: IS_STAGE
    ? 'https://logistics-stage.ecpay.com.tw/Helper/QueryLogisticsTradeInfo/V5'
    : 'https://logistics.ecpay.com.tw/Helper/QueryLogisticsTradeInfo/V5',
  /** 列印 C2C 一段標 */
  logisticsPrintUnimartC2C: IS_STAGE
    ? 'https://logistics-stage.ecpay.com.tw/Express/PrintUniMartC2COrderInfo'
    : 'https://logistics.ecpay.com.tw/Express/PrintUniMartC2COrderInfo',
  logisticsPrintFamiC2C: IS_STAGE
    ? 'https://logistics-stage.ecpay.com.tw/Express/PrintFAMIC2COrderInfo'
    : 'https://logistics.ecpay.com.tw/Express/PrintFAMIC2COrderInfo',
  logisticsPrintHilifeC2C: IS_STAGE
    ? 'https://logistics-stage.ecpay.com.tw/Express/PrintHILIFEC2COrderInfo'
    : 'https://logistics.ecpay.com.tw/Express/PrintHILIFEC2COrderInfo',
  logisticsPrintOkmartC2C: IS_STAGE
    ? 'https://logistics-stage.ecpay.com.tw/Express/PrintOKMARTC2COrderInfo'
    : 'https://logistics.ecpay.com.tw/Express/PrintOKMARTC2COrderInfo',
  /** 列印宅配托運單 */
  logisticsPrintTradeDoc: IS_STAGE
    ? 'https://logistics-stage.ecpay.com.tw/helper/printTradeDocument'
    : 'https://logistics.ecpay.com.tw/helper/printTradeDocument',

  /** 電子發票 B2C v3（JSON + AES-128-CBC） */
  invoiceIssue: IS_STAGE
    ? 'https://einvoice-stage.ecpay.com.tw/B2CInvoice/Issue'
    : 'https://einvoice.ecpay.com.tw/B2CInvoice/Issue',
  invoiceVoid: IS_STAGE
    ? 'https://einvoice-stage.ecpay.com.tw/B2CInvoice/Invalid'
    : 'https://einvoice.ecpay.com.tw/B2CInvoice/Invalid',
  invoiceQuery: IS_STAGE
    ? 'https://einvoice-stage.ecpay.com.tw/B2CInvoice/GetIssue'
    : 'https://einvoice.ecpay.com.tw/B2CInvoice/GetIssue',
} as const

export const paymentConfig = {
  merchantId: env.ECPAY_MERCHANT_ID,
  credentials: {
    hashKey: env.ECPAY_HASH_KEY,
    hashIV: env.ECPAY_HASH_IV,
  } satisfies EcpayCredentials,
}

/** 宅配（B2C）用的物流商店代號 */
export const logisticsConfig = {
  merchantId: env.ECPAY_LOGISTICS_MERCHANT_ID,
  credentials: {
    hashKey: env.ECPAY_LOGISTICS_HASH_KEY,
    hashIV: env.ECPAY_LOGISTICS_HASH_IV,
  } satisfies EcpayCredentials,
}

/** 超商取貨（C2C）用的物流商店代號，綠界規定與 B2C 分開申請 */
export const logisticsC2CConfig = {
  merchantId: env.ECPAY_LOGISTICS_C2C_MERCHANT_ID,
  credentials: {
    hashKey: env.ECPAY_LOGISTICS_C2C_HASH_KEY,
    hashIV: env.ECPAY_LOGISTICS_C2C_HASH_IV,
  } satisfies EcpayCredentials,
}

export const invoiceConfig = {
  merchantId: env.ECPAY_INVOICE_MERCHANT_ID,
  hashKey: env.ECPAY_INVOICE_HASH_KEY,
  hashIV: env.ECPAY_INVOICE_HASH_IV,
  autoIssue: env.ECPAY_INVOICE_AUTO_ISSUE,
}

export const senderConfig = {
  name: env.ECPAY_SENDER_NAME,
  phone: env.ECPAY_SENDER_PHONE,
  cellphone: env.ECPAY_SENDER_CELLPHONE,
  zipCode: env.ECPAY_SENDER_ZIPCODE,
  address: env.ECPAY_SENDER_ADDRESS,
}

/** 組出綠界要回拋的公開網址 */
export function callbackUrl(path: string): string {
  return new URL(path, env.APP_URL).toString()
}

/**
 * 綠界的 callback 一定要打得到我們的伺服器。
 * localhost 是打不到的，本機開發要開 cloudflared tunnel 並把 APP_URL 換成 tunnel 網址。
 */
export function isCallbackReachable(): boolean {
  return !/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test(env.APP_URL)
}
