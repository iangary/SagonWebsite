import { type NextRequest } from 'next/server'
import { verifyAioCallback, ECPAY_ACK } from '@/lib/ecpay/aio'
import {
  readCallbackParams,
  recordWebhook,
  markWebhookProcessed,
  markWebhookFailed,
} from '@/lib/ecpay/webhook'
import { handlePaymentInfo } from '@/lib/orders/payment'

export const dynamic = 'force-dynamic'

/**
 * ATM 虛擬帳號 / 超商繳費代碼的取號通知（PaymentInfoURL）。
 * 這時尚未收款，只是拿到繳費資訊，要存下來並寄給消費者。
 */
export async function POST(req: NextRequest) {
  const params = await readCallbackParams(req)
  const signatureValid = verifyAioCallback(params)

  const event = await recordWebhook('payment_info', params, signatureValid)

  if (!signatureValid) {
    await markWebhookFailed(event.id, new Error('CheckMacValue 驗證失敗'))
    return text('0|CheckMacValue Error')
  }

  if (event.alreadyProcessed) return text(ECPAY_ACK)

  try {
    await handlePaymentInfo(params)
    await markWebhookProcessed(event.id)
    return text(ECPAY_ACK)
  } catch (error) {
    await markWebhookFailed(event.id, error)
    console.error('[ecpay:payment/info] 處理失敗', error)
    return text('0|Internal Error')
  }
}

function text(body: string) {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
