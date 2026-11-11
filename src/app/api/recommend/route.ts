import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getRedis } from '@/lib/queue'
import { loadCandidates } from '@/lib/recommend/candidates'
import { clientIp, hitRateLimit, withTimeout } from '@/lib/recommend/guard'
import { BODY_LIMITS } from '@/lib/recommend/limits'
import { recommend } from '@/lib/recommend/recommend'

/**
 * 首頁「尺寸推薦」：身高、體重（必填）與胸圍（選填）→ 依適穿對照表推薦有現貨的商品與尺寸。
 *
 * 錯誤一律回機器判讀的 code（INVALID / RATE_LIMITED / FAILED），文案由前端依語系顯示。
 */

const number = (limits: { min: number; max: number }) =>
  z.number().finite().min(limits.min).max(limits.max)

const payloadSchema = z.object({
  heightCm: number(BODY_LIMITS.height),
  weightKg: number(BODY_LIMITS.weight),
  bustCm: number(BODY_LIMITS.bust).optional(),
})

const REDIS_TIMEOUT_MS = 1500

function failure(code: string, status: number, headers?: HeadersInit) {
  return NextResponse.json({ code }, { status, headers: { 'Cache-Control': 'no-store', ...headers } })
}

export async function POST(request: Request) {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return failure('INVALID', 400)
  }
  const parsed = payloadSchema.safeParse(payload)
  if (!parsed.success) return failure('INVALID', 400)

  // Redis 掛掉時不擋顧客 —— 比對很便宜，少一道頻率限制的風險比整個功能壞掉小
  try {
    const limit = await hitRateLimit(withTimeout(getRedis(), REDIS_TIMEOUT_MS), clientIp(request.headers))
    if (!limit.ok) {
      return failure('RATE_LIMITED', 429, { 'Retry-After': String(limit.retryAfterSeconds) })
    }
  } catch (error) {
    console.warn('[recommend] Redis 無法使用，略過頻率限制', error instanceof Error ? error.message : error)
  }

  try {
    const result = await recommend(parsed.data, loadCandidates)
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[recommend] 推薦失敗', error)
    return failure('FAILED', 500)
  }
}
