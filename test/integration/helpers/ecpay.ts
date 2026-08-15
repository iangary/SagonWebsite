import { generateCheckMacValue } from '@/lib/ecpay/checkmac'
import { env } from '@/lib/env'
import type { Order, Payment } from '@prisma/client'

/**
 * 產生「簽章正確」的綠界回拋參數，餵給 handlePaymentReturn / route handler。
 *
 * 簽章用正式的 generateCheckMacValue —— 它已被 checkmac.test.ts 的
 * golden test（綠界官方文件範例）釘住，這裡不需要再獨立實作一份。
 */

function tradeDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function sign(params: Record<string, string>): Record<string, string> {
  const creds = { hashKey: env.ECPAY_HASH_KEY, hashIV: env.ECPAY_HASH_IV }
  return { ...params, CheckMacValue: generateCheckMacValue(params, creds, 'sha256') }
}

/** 付款成功（ReturnURL）通知 */
export function signedPaymentReturnParams(
  order: Pick<Order, 'grandTotal'> & { payment: Pick<Payment, 'merchantTradeNo'> | null },
  overrides: Record<string, string> = {},
): Record<string, string> {
  const base: Record<string, string> = {
    MerchantID: env.ECPAY_MERCHANT_ID,
    MerchantTradeNo: order.payment?.merchantTradeNo ?? '',
    StoreID: '',
    RtnCode: '1',
    RtnMsg: '交易成功',
    TradeNo: `SIM${Date.now()}${Math.floor(Math.random() * 1000)}`,
    TradeAmt: String(order.grandTotal),
    PaymentDate: tradeDate(),
    PaymentType: 'Credit_CreditCard',
    PaymentTypeChargeFee: '0',
    TradeDate: tradeDate(),
    SimulatePaid: '1',
    CustomField1: '',
    CustomField2: '',
    CustomField3: '',
    CustomField4: '',
    ...overrides,
  }
  return sign(base)
}

/** ATM 取號（PaymentInfoURL）通知 */
export function signedPaymentInfoParams(
  order: Pick<Order, 'grandTotal'> & { payment: Pick<Payment, 'merchantTradeNo'> | null },
  overrides: Record<string, string> = {},
): Record<string, string> {
  const base: Record<string, string> = {
    MerchantID: env.ECPAY_MERCHANT_ID,
    MerchantTradeNo: order.payment?.merchantTradeNo ?? '',
    StoreID: '',
    RtnCode: '2',
    RtnMsg: 'Get VirtualAccount Succeeded',
    TradeNo: `SIM${Date.now()}${Math.floor(Math.random() * 1000)}`,
    TradeAmt: String(order.grandTotal),
    PaymentType: 'ATM_TAISHIN',
    TradeDate: tradeDate(),
    BankCode: '812',
    vAccount: '9990012345678901',
    ExpireDate: '2026/12/31',
    CustomField1: '',
    CustomField2: '',
    CustomField3: '',
    CustomField4: '',
    ...overrides,
  }
  return sign(base)
}

/** CVS 取號通知（繳費代碼） */
export function signedCvsPaymentInfoParams(
  order: Pick<Order, 'grandTotal'> & { payment: Pick<Payment, 'merchantTradeNo'> | null },
  overrides: Record<string, string> = {},
): Record<string, string> {
  return signedPaymentInfoParams(order, {
    RtnCode: '10100073',
    RtnMsg: 'Get CVS Code Succeeded.',
    PaymentType: 'CVS_CVS',
    PaymentNo: 'LLL22167774958',
    BankCode: '',
    vAccount: '',
    ...overrides,
  })
}

/** 把回拋參數包成 form-urlencoded 的 Request，直接餵 route handler 用 */
export function callbackRequest(path: string, params: Record<string, string>): Request {
  return new Request(new URL(path, env.APP_URL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  })
}
