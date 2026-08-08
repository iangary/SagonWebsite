import 'server-only'
import { headers } from 'next/headers'
import { db } from '@/lib/db'

/**
 * 記錄後台操作。所有會改到訂單、商品、優惠券的動作都要留痕，
 * 事後對帳或客訴時才查得出「是誰在什麼時候改了什麼」。
 */
export async function audit(params: {
  userId: string
  action: string
  entity: string
  entityId?: string
  before?: unknown
  after?: unknown
}): Promise<void> {
  let ip: string | null = null
  try {
    const h = await headers()
    // 走反向代理時真實 IP 在 x-forwarded-for 的第一段
    ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null
  } catch {
    // 不在請求情境（例如 worker）就沒有 IP，不影響記錄本身
  }

  await db.auditLog.create({
    data: {
      userId: params.userId,
      action: params.action,
      entity: params.entity,
      entityId: params.entityId ?? null,
      before: (params.before ?? undefined) as never,
      after: (params.after ?? undefined) as never,
      ip,
    },
  })
}
