import 'server-only'
import { generateCheckMacValue, verifyCheckMacValue } from './checkmac'
import { callbackUrl, ecpayEndpoints, paymentConfig } from './config'

/**
 * 綠界全方位金流（AIO）。
 *
 * 流程：我們產生一張帶 CheckMacValue 的表單 → 瀏覽器自動 submit 到綠界收銀台
 * → 使用者付款 → 綠界打 ReturnURL（背景，權威）與 OrderResultURL（前台導回）。
 */

export type ChoosePayment = 'Credit' | 'ATM' | 'CVS' | 'BARCODE' | 'ALL'

export interface AioOrderInput {
  merchantTradeNo: string
  totalAmount: number
  tradeDesc: string
  items: { name: string; qty: number; unitPrice: number }[]
  choosePayment: ChoosePayment
  /** 未付款訂單的有效期（ATM 是天、CVS 是分鐘），與庫存預扣時間對齊 */
  expireMinutes?: number
  customField1?: string
}

/** 綠界 MerchantTradeDate 的格式固定是 yyyy/MM/dd HH:mm:ss（台北時間） */
export function formatTradeDate(date = new Date()): string {
  const taipei = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }))
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${taipei.getFullYear()}/${pad(taipei.getMonth() + 1)}/${pad(taipei.getDate())} ` +
    `${pad(taipei.getHours())}:${pad(taipei.getMinutes())}:${pad(taipei.getSeconds())}`
  )
}

/**
 * ItemName 用 # 分隔多筆商品，且綠界規定總長度不得超過 400 字元。
 * 商品名稱裡的 # 會破壞分隔，先換掉。
 */
export function buildItemName(items: AioOrderInput['items']): string {
  const joined = items
    .map((i) => `${i.name.replace(/#/g, '＃')} NT$${i.unitPrice} x ${i.qty}`)
    .join('#')
  return joined.length <= 400 ? joined : `${joined.slice(0, 397)}...`
}

/**
 * MerchantTradeNo：僅英數、最長 20 碼、全站唯一。
 * 用「時間戳 base36 + 隨機碼」，短、單調遞增、看得出先後順序。
 */
export function generateMerchantTradeNo(prefix = 'SG'): string {
  const ts = Date.now().toString(36).toUpperCase()
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `${prefix}${ts}${rand}`.slice(0, 20)
}

/**
 * 產生要 POST 給綠界的完整參數（含 CheckMacValue）。
 * 回傳的是純物件，由 route handler 轉成自動送出的 HTML 表單。
 */
export function buildAioCheckoutParams(input: AioOrderInput): Record<string, string> {
  const params: Record<string, string> = {
    MerchantID: paymentConfig.merchantId,
    MerchantTradeNo: input.merchantTradeNo,
    MerchantTradeDate: formatTradeDate(),
    PaymentType: 'aio',
    TotalAmount: String(input.totalAmount),
    TradeDesc: input.tradeDesc,
    ItemName: buildItemName(input.items),
    // 背景通知：這支才是判斷「有沒有付款成功」的唯一依據
    ReturnURL: callbackUrl('/api/ecpay/payment/return'),
    // 前台導回：只負責顯示結果頁，不能拿來改訂單狀態
    OrderResultURL: callbackUrl('/api/ecpay/payment/result'),
    ClientBackURL: callbackUrl('/cart'),
    ChoosePayment: input.choosePayment,
    // 1 = SHA256
    EncryptType: '1',
    NeedExtraPaidInfo: 'Y',
  }

  if (input.customField1) params.CustomField1 = input.customField1

  // ATM/CVS 取號後才付款，需要另一支通知告訴我們虛擬帳號或繳費代碼
  if (input.choosePayment === 'ATM' || input.choosePayment === 'CVS' || input.choosePayment === 'BARCODE') {
    params.PaymentInfoURL = callbackUrl('/api/ecpay/payment/info')
  }

  if (input.expireMinutes) {
    if (input.choosePayment === 'ATM') {
      // ATM 的單位是「天」，最少 1 天
      params.ExpireDate = String(Math.max(1, Math.ceil(input.expireMinutes / (60 * 24))))
    } else if (input.choosePayment === 'CVS' || input.choosePayment === 'BARCODE') {
      // CVS 的單位是「分鐘」，綠界限制 1 分鐘 ~ 43200 分鐘
      params.StoreExpireDate = String(Math.min(43200, Math.max(1, input.expireMinutes)))
    }
  }

  params.CheckMacValue = generateCheckMacValue(params, paymentConfig.credentials, 'sha256')
  return params
}

/** 驗證綠界回拋的簽章 */
export function verifyAioCallback(params: Record<string, string>): boolean {
  return verifyCheckMacValue(params, paymentConfig.credentials, 'sha256')
}

/**
 * 綠界回拋的付款結果。RtnCode === 1 代表付款成功；
 * ATM/CVS 取號成功的通知走 PaymentInfoURL，RtnCode 為 2（ATM）或 10100073（CVS）。
 */
export interface AioReturnPayload {
  MerchantTradeNo: string
  TradeNo: string
  RtnCode: string
  RtnMsg: string
  TradeAmt: string
  PaymentDate: string
  PaymentType: string
  PaymentTypeChargeFee: string
  SimulatePaid: string
  CustomField1?: string
}

export function isPaymentSuccessful(params: Record<string, string>): boolean {
  return params.RtnCode === '1'
}

/**
 * 測試環境的「模擬付款」也會回 RtnCode=1，但 SimulatePaid=1。
 * 正式環境要拒絕這種通知，否則有人可以用模擬付款騙到出貨。
 */
export function isSimulatedPayment(params: Record<string, string>): boolean {
  return params.SimulatePaid === '1'
}

/** 綠界要求 callback 回覆這串純文字，否則會一直重送 */
export const ECPAY_ACK = '1|OK'

/** 查詢單筆訂單在綠界端的狀態，用於對帳與人工補單 */
export async function queryTradeInfo(merchantTradeNo: string): Promise<Record<string, string>> {
  const params: Record<string, string> = {
    MerchantID: paymentConfig.merchantId,
    MerchantTradeNo: merchantTradeNo,
    TimeStamp: String(Math.floor(Date.now() / 1000)),
  }
  params.CheckMacValue = generateCheckMacValue(params, paymentConfig.credentials, 'sha256')

  const res = await fetch(ecpayEndpoints.queryTradeInfo, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) throw new Error(`綠界查詢失敗：HTTP ${res.status}`)

  // 回應是 query string 格式，不是 JSON
  return Object.fromEntries(new URLSearchParams(await res.text()))
}
