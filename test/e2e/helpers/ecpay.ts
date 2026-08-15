import { createHash } from 'node:crypto'
import { expect, type APIRequestContext } from '@playwright/test'

/**
 * 模擬綠界背景通知的 E2E 版本，改寫自 scripts/simulate-ecpay-callback.ts
 * （該腳本是 CLI、import 就會執行，無法直接引用）。
 *
 * 簽章刻意獨立實作、不引用 src/lib/ecpay/checkmac.ts —— 測到自己的 bug
 * 就沒有意義了。金鑰從 process.env 讀（playwright.config.ts 會載入 .env）。
 */

export function ecpayEnvReady(): boolean {
  return Boolean(
    process.env.ECPAY_MERCHANT_ID && process.env.ECPAY_HASH_KEY && process.env.ECPAY_HASH_IV,
  )
}

function creds() {
  if (process.env.ECPAY_ENV === 'production') {
    throw new Error('拒絕在 ECPAY_ENV=production 下模擬綠界回拋')
  }
  const merchantId = process.env.ECPAY_MERCHANT_ID
  const hashKey = process.env.ECPAY_HASH_KEY
  const hashIV = process.env.ECPAY_HASH_IV
  if (!merchantId || !hashKey || !hashIV) {
    throw new Error('缺少 ECPAY_MERCHANT_ID / ECPAY_HASH_KEY / ECPAY_HASH_IV（.env 未載入？）')
  }
  return { merchantId, hashKey, hashIV }
}

/** 與綠界文件相同的 CheckMacValue 演算法（.NET UrlEncode + SHA256） */
export function signAioParams(params: Record<string, string>): string {
  const { hashKey, hashIV } = creds()
  const body = Object.entries(params)
    .filter(([k]) => k !== 'CheckMacValue')
    .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase(), 'en'))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')

  const raw = `HashKey=${hashKey}&${body}&HashIV=${hashIV}`
  const encoded = encodeURIComponent(raw)
    .replace(/%20/g, '+')
    .replace(/'/g, '%27')
    .replace(/~/g, '%7e')
    .toLowerCase()

  return createHash('sha256').update(encoded, 'utf8').digest('hex').toUpperCase()
}

function tradeDate(): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const d = new Date()
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function baseParams(orderNo: string, amount: number): Record<string, string> {
  return {
    MerchantID: creds().merchantId,
    MerchantTradeNo: orderNo,
    StoreID: '',
    RtnCode: '',
    RtnMsg: '',
    TradeNo: `SIM${Date.now()}`,
    TradeAmt: String(amount),
    PaymentDate: tradeDate(),
    PaymentType: '',
    PaymentTypeChargeFee: '0',
    TradeDate: tradeDate(),
    SimulatePaid: '1',
    CustomField1: '',
    CustomField2: '',
    CustomField3: '',
    CustomField4: '',
  }
}

/** 付款成功（ReturnURL）參數，已簽章 */
export function buildPaymentReturn(
  orderNo: string,
  amount: number,
  overrides: Record<string, string> = {},
): Record<string, string> {
  const params: Record<string, string> = {
    ...baseParams(orderNo, amount),
    RtnCode: '1',
    RtnMsg: '交易成功',
    PaymentType: 'Credit_CreditCard',
    ...overrides,
  }
  params.CheckMacValue = signAioParams(params)
  return params
}

/** ATM 取號（PaymentInfoURL）參數，已簽章 */
export function buildPaymentInfo(
  orderNo: string,
  amount: number,
  overrides: Record<string, string> = {},
): Record<string, string> {
  const params: Record<string, string> = {
    ...baseParams(orderNo, amount),
    RtnCode: '2',
    RtnMsg: 'Get VirtualAccount Succeeded',
    PaymentType: 'ATM_TAISHIN',
    BankCode: '812',
    vAccount: '9990012345678901',
    ExpireDate: '2026/12/31',
    ...overrides,
  }
  params.CheckMacValue = signAioParams(params)
  return params
}

/** 超商代碼取號參數，已簽章 */
export function buildCvsPaymentInfo(
  orderNo: string,
  amount: number,
  overrides: Record<string, string> = {},
): Record<string, string> {
  return buildPaymentInfo(orderNo, amount, {
    RtnCode: '10100073',
    RtnMsg: 'Get CVS Code Succeeded.',
    PaymentType: 'CVS_CVS',
    PaymentNo: 'LLL22167774958',
    BankCode: '',
    vAccount: '',
    ...overrides,
  })
}

/** 從 dev-only 路由取得訂單金額（正式環境該路由回 404） */
export async function getOrderAmount(request: APIRequestContext, orderNo: string): Promise<number> {
  const res = await request.get(`/api/orders/${orderNo}/amount`)
  expect(res.ok(), `取不到訂單 ${orderNo} 的金額（/api/orders/[orderNo]/amount）`).toBeTruthy()
  const { grandTotal } = (await res.json()) as { grandTotal: number }
  return grandTotal
}

export async function postCallback(
  request: APIRequestContext,
  path: string,
  params: Record<string, string>,
): Promise<{ status: number; body: string }> {
  const res = await request.post(path, { form: params })
  return { status: res.status(), body: await res.text() }
}

/** 模擬信用卡付款成功並斷言綠界收到 1|OK */
export async function simulatePaid(
  request: APIRequestContext,
  orderNo: string,
  overrides: Record<string, string> = {},
): Promise<void> {
  const amount = await getOrderAmount(request, orderNo)
  const { body } = await postCallback(
    request,
    '/api/ecpay/payment/return',
    buildPaymentReturn(orderNo, amount, overrides),
  )
  expect(body).toBe('1|OK')
}

/** 模擬 ATM 取號通知 */
export async function simulateAtmInfo(
  request: APIRequestContext,
  orderNo: string,
  overrides: Record<string, string> = {},
): Promise<void> {
  const amount = await getOrderAmount(request, orderNo)
  const { body } = await postCallback(
    request,
    '/api/ecpay/payment/info',
    buildPaymentInfo(orderNo, amount, overrides),
  )
  expect(body).toBe('1|OK')
}

/** 模擬超商代碼取號通知 */
export async function simulateCvsInfo(
  request: APIRequestContext,
  orderNo: string,
  overrides: Record<string, string> = {},
): Promise<void> {
  const amount = await getOrderAmount(request, orderNo)
  const { body } = await postCallback(
    request,
    '/api/ecpay/payment/info',
    buildCvsPaymentInfo(orderNo, amount, overrides),
  )
  expect(body).toBe('1|OK')
}
