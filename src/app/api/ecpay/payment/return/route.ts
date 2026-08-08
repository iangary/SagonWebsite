import { type NextRequest } from 'next/server'
import { verifyAioCallback, ECPAY_ACK } from '@/lib/ecpay/aio'
import {
  readCallbackParams,
  recordWebhook,
  markWebhookProcessed,
  markWebhookFailed,
} from '@/lib/ecpay/webhook'
import { handlePaymentReturn } from '@/lib/orders/payment'

export const dynamic = 'force-dynamic'

/**
 * 綠界付款結果的背景通知（ReturnURL）。
 *
 * 綠界的規則：只要回應不是「1|OK」就會不斷重送（約 15 次）。
 * 所以這裡的策略是：
 *   - 簽章錯誤 → 回 0|ErrorMessage，不要處理，也不要讓它一直重送
 *   - 處理成功或已處理過 → 回 1|OK
 *   - 處理過程出錯 → 回 0|...，讓綠界重送，我們有機會補救
 */
export async function POST(req: NextRequest) {
  const params = await readCallbackParams(req)
  const signatureValid = verifyAioCallback(params)

  const event = await recordWebhook('payment_return', params, signatureValid)

  if (!signatureValid) {
    await markWebhookFailed(event.id, new Error('CheckMacValue 驗證失敗'))
    console.error('[ecpay:payment/return] 簽章驗證失敗', params.MerchantTradeNo)
    return text('0|CheckMacValue Error')
  }

  // 重送同一筆已處理完成的通知，直接確認即可
  if (event.alreadyProcessed) return text(ECPAY_ACK)

  try {
    await handlePaymentReturn(params)
    await markWebhookProcessed(event.id)
    return text(ECPAY_ACK)
  } catch (error) {
    await markWebhookFailed(event.id, error)
    console.error('[ecpay:payment/return] 處理失敗', error)
    return text('0|Internal Error')
  }
}

function text(body: string) {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
