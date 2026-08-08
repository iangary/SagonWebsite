import { type NextRequest } from 'next/server'
import { ECPAY_ACK } from '@/lib/ecpay/aio'
import { verifyLogisticsCallback } from '@/lib/ecpay/logistics'
import {
  readCallbackParams,
  recordWebhook,
  markWebhookProcessed,
  markWebhookFailed,
} from '@/lib/ecpay/webhook'
import { handleLogisticsReply } from '@/lib/orders/logistics'

export const dynamic = 'force-dynamic'

/**
 * 綠界物流的狀態回拋（ServerReplyURL）。
 * 從「已出貨」一路到「已取貨」都會打這裡，每次都是一筆新的狀態。
 */
export async function POST(req: NextRequest) {
  const params = await readCallbackParams(req)
  const signatureValid = verifyLogisticsCallback(params)

  const event = await recordWebhook('logistics_reply', params, signatureValid)

  if (!signatureValid) {
    await markWebhookFailed(event.id, new Error('CheckMacValue 驗證失敗'))
    console.error('[ecpay:logistics/reply] 簽章驗證失敗', params.MerchantTradeNo)
    return text('0|CheckMacValue Error')
  }

  if (event.alreadyProcessed) return text(ECPAY_ACK)

  try {
    await handleLogisticsReply(params)
    await markWebhookProcessed(event.id)
    return text(ECPAY_ACK)
  } catch (error) {
    await markWebhookFailed(event.id, error)
    console.error('[ecpay:logistics/reply] 處理失敗', error)
    return text('0|Internal Error')
  }
}

function text(body: string) {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
