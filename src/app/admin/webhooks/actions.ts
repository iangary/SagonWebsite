'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { markWebhookFailed, markWebhookProcessed } from '@/lib/ecpay/webhook'
import { handlePaymentReturn, handlePaymentInfo } from '@/lib/orders/payment'
import { handleLogisticsReply } from '@/lib/orders/logistics'

/**
 * 手動重送一筆未處理的 webhook。
 *
 * 用途：綠界通知進來時我們的伺服器正在部署／DB 短暫斷線，
 * 事件已經落地但處理失敗。修好之後從這裡補跑，不用請綠界重送。
 */
export async function retryWebhook(eventId: string): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin()

  const event = await db.webhookEvent.findUnique({ where: { id: eventId } })
  if (!event) return { ok: false, error: '找不到這筆事件' }
  if (event.processedAt) return { ok: false, error: '這筆事件已經處理過了' }

  // 簽章無效的事件不能補跑 —— 內容不可信
  if (!event.signatureValid) {
    return { ok: false, error: '簽章驗證失敗的事件不允許重送' }
  }

  const params = event.payload as Record<string, string>

  try {
    switch (event.kind) {
      case 'payment_return':
        await handlePaymentReturn(params)
        break
      case 'payment_info':
        await handlePaymentInfo(params)
        break
      case 'logistics_reply':
        await handleLogisticsReply(params)
        break
      default:
        return { ok: false, error: `不支援重送的事件類型：${event.kind}` }
    }

    await markWebhookProcessed(eventId)
    await audit({
      userId: admin.id,
      action: 'webhook.retry',
      entity: 'WebhookEvent',
      entityId: eventId,
      after: { kind: event.kind },
    })

    revalidatePath('/admin/webhooks')
    return { ok: true }
  } catch (error) {
    await markWebhookFailed(eventId, error)
    revalidatePath('/admin/webhooks')
    return { ok: false, error: (error as Error).message }
  }
}
