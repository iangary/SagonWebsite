import 'server-only'
import { generateCheckMacValue } from './checkmac'
import { ecpayEndpoints, paymentConfig } from './config'

/**
 * 綠界信用卡請退款（CreditDetail/DoAction）。
 *
 * ⚠️ 只有信用卡能用這支。ATM、超商代碼、超商條碼是消費者臨櫃／轉帳付現，
 * 綠界**沒有**線上退款 API —— 那些只能請消費者提供帳戶後人工匯款
 * （見 lib/orders/refund.ts 的 MANUAL_TRANSFER）。
 *
 * Action 的四種值與訂單狀態的對應（綠界文件 2885）：
 *   C 關帳（請款）  N 放棄授權   E 取消關帳   R 退刷
 * 我們的情境是「消費者付款後要退錢」，綠界預設自動關帳，所以一律送 R。
 * 分期交易只能全額退，一般授權可以部分退。
 *
 * 回應是 URL-encoded 的純文字（不是 JSON），成功為 1|OK。
 */

export interface RefundInput {
  merchantTradeNo: string
  /** 綠界的交易編號。付款成功的回拋才會有，沒有就退不了。 */
  tradeNo: string
  /** 退款金額（元）。目前只做全額退款。 */
  amount: number
}

export type RefundResult =
  | { ok: true; raw: string }
  | { ok: false; error: string; raw: string }

export async function refundCreditCard(input: RefundInput): Promise<RefundResult> {
  const params: Record<string, string> = {
    MerchantID: paymentConfig.merchantId,
    MerchantTradeNo: input.merchantTradeNo,
    TradeNo: input.tradeNo,
    Action: 'R',
    TotalAmount: String(input.amount),
  }
  params.CheckMacValue = generateCheckMacValue(params, paymentConfig.credentials, 'sha256')

  const res = await fetch(ecpayEndpoints.creditDetailDoAction, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(20_000),
  })

  const text = await res.text()
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, raw: text }

  return parseDoActionResponse(text)
}

/**
 * DoAction 的回應格式是 `MerchantID=...&MerchantTradeNo=...&RtnCode=1&RtnMsg=...`。
 * RtnCode 是字串 '1' 才算成功（CMV 類服務的 RtnCode 都是字串）。
 */
export function parseDoActionResponse(body: string): RefundResult {
  const parsed = Object.fromEntries(new URLSearchParams(body.trim()))
  const code = parsed.RtnCode ?? ''

  if (code === '1') return { ok: true, raw: body }

  const message = parsed.RtnMsg ?? body.slice(0, 200)
  return { ok: false, error: `${code || '未知代碼'}: ${message}`, raw: body }
}

/** 只有信用卡付款能走退刷 API。paymentType 是綠界回拋的實際付款方式。 */
export function isCreditCardPayment(choosePayment: string, paymentType: string | null): boolean {
  if (paymentType) return paymentType.startsWith('Credit')
  return choosePayment === 'Credit'
}
