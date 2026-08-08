import 'server-only'
import { createHash } from 'node:crypto'
import { db } from '@/lib/db'
import { formDataToParams } from './checkmac'

export type WebhookKind =
  | 'payment_return'
  | 'payment_info'
  | 'logistics_reply'
  | 'logistics_map'

/**
 * 綠界的回拋沒有原生的事件 id，所以用「業務主鍵 + payload 內容雜湊」當外部 id。
 *
 * 這讓真正的重送（完全相同的 payload）被擋掉，
 * 但同一筆訂單後續狀態改變（例如物流從「已出貨」變「已到店」）仍會被視為新事件。
 */
export function deriveExternalId(kind: WebhookKind, params: Record<string, string>): string {
  const businessKey =
    params.MerchantTradeNo ?? params.AllPayLogisticsID ?? params.TradeNo ?? 'unknown'

  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify(
        Object.entries(params)
          .filter(([k]) => k !== 'CheckMacValue')
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    )
    .digest('hex')
    .slice(0, 16)

  return `${businessKey}:${fingerprint}`
}

export interface RecordedWebhook {
  id: string
  /** true 代表這筆之前已經成功處理過，呼叫端應直接回 ACK 不要重複處理 */
  alreadyProcessed: boolean
  externalId: string
}

/**
 * 把回拋落地成 WebhookEvent。
 * 靠 (provider, kind, externalId) 的唯一索引達成冪等 —— 併發重送時
 * 第二筆會撞到唯一鍵，我們據此判斷是重複事件。
 */
export async function recordWebhook(
  kind: WebhookKind,
  params: Record<string, string>,
  signatureValid: boolean,
  headers?: Record<string, string>,
): Promise<RecordedWebhook> {
  const externalId = deriveExternalId(kind, params)

  const existing = await db.webhookEvent.findUnique({
    where: { provider_kind_externalId: { provider: 'ECPAY', kind, externalId } },
    select: { id: true, processedAt: true },
  })

  if (existing) {
    return {
      id: existing.id,
      alreadyProcessed: existing.processedAt !== null,
      externalId,
    }
  }

  const created = await db.webhookEvent.create({
    data: {
      provider: 'ECPAY',
      kind,
      externalId,
      merchantTradeNo: params.MerchantTradeNo ?? null,
      payload: params,
      headers: headers ?? undefined,
      signatureValid,
    },
    select: { id: true },
  })

  return { id: created.id, alreadyProcessed: false, externalId }
}

export async function markWebhookProcessed(id: string): Promise<void> {
  await db.webhookEvent.update({
    where: { id },
    data: { processedAt: new Date(), attempts: { increment: 1 }, error: null },
  })
}

export async function markWebhookFailed(id: string, error: unknown): Promise<void> {
  await db.webhookEvent.update({
    where: { id },
    data: {
      attempts: { increment: 1 },
      error: error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error),
    },
  })
}

/** 綠界的回拋一律是 application/x-www-form-urlencoded */
export async function readCallbackParams(req: Request): Promise<Record<string, string>> {
  const contentType = req.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    return (await req.json()) as Record<string, string>
  }

  return formDataToParams(await req.formData())
}
