import 'server-only'
import { env } from '@/lib/env'
import type { EcpayCredentials } from './checkmac'

/**
 * 綠界三個服務各有自己的商店代號與端點，測試站與正式站也不同。
 * 全部集中在這裡，程式其他地方不要出現任何硬編的網址或金鑰。
 *
 * 目前使用的服務：全方位金流 AIO、物流（僅超商 C2C）、電子收據。
 * 宅配走黑貓自己的系統；電子發票沒有申請，紙本由人工開立隨包裹寄出。
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

  /** 電子收據（JSON + AES-128-CBC）。注意 domain 與電子發票共用 einvoice。 */
  receiptIssue: IS_STAGE
    ? 'https://einvoice-stage.ecpay.com.tw/Receipt/Issue'
    : 'https://einvoice.ecpay.com.tw/Receipt/Issue',
  receiptInvalid: IS_STAGE
    ? 'https://einvoice-stage.ecpay.com.tw/Receipt/Invalid'
    : 'https://einvoice.ecpay.com.tw/Receipt/Invalid',
  receiptQuery: IS_STAGE
    ? 'https://einvoice-stage.ecpay.com.tw/Receipt/GetReceipt'
    : 'https://einvoice.ecpay.com.tw/Receipt/GetReceipt',
} as const

export const paymentConfig = {
  merchantId: env.ECPAY_MERCHANT_ID,
  credentials: {
    hashKey: env.ECPAY_HASH_KEY,
    hashIV: env.ECPAY_HASH_IV,
  } satisfies EcpayCredentials,
}

/**
 * 物流商店代號。綠界的超商申請類型分 B2C 與 C2C，兩者不共用商店代號也不能混串，
 * 我們申請的是 C2C，所以只有這一組。
 */
export const logisticsConfig = {
  merchantId: env.ECPAY_LOGISTICS_MERCHANT_ID,
  credentials: {
    hashKey: env.ECPAY_LOGISTICS_HASH_KEY,
    hashIV: env.ECPAY_LOGISTICS_HASH_IV,
  } satisfies EcpayCredentials,
}

export const receiptConfig = {
  merchantId: env.ECPAY_RECEIPT_MERCHANT_ID,
  hashKey: env.ECPAY_RECEIPT_HASH_KEY,
  hashIV: env.ECPAY_RECEIPT_HASH_IV,
  autoIssue: env.ECPAY_RECEIPT_AUTO_ISSUE,
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
