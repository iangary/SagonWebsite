import 'server-only'
import IORedis from 'ioredis'
import { env } from '@/lib/env'

/**
 * 以 Redis 計數的固定視窗節流，擋暴力嘗試（密碼登入、訪客查單、索取簡訊）。
 *
 * 不共用 lib/queue.ts 的 getRedis()：那條連線是給 BullMQ 的，`maxRetriesPerRequest: null`
 * 會讓指令在 Redis 掉線時無限期排隊 —— 套在登入上，Redis 一掛整站就登不進去。
 * 這裡關掉 offline queue、只重試一次，Redis 不在時指令立刻失敗。
 *
 * **Redis 不通時一律放行（fail open）。** 節流是第二道防線，第一道是密碼雜湊、
 * OTP 嘗試上限與簡訊每號碼／全站上限（那幾道都在資料庫裡，不靠 Redis）。
 * 為了節流把正常客人擋在門外，比少擋一陣子暴力嘗試更糟。
 */

const globalForRateLimit = globalThis as unknown as { rateLimitRedis?: IORedis }

let lastErrorLoggedAt = 0

function client(): IORedis {
  if (!globalForRateLimit.rateLimitRedis) {
    const redis = new IORedis(env.REDIS_URL, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
    })
    redis.on('error', (error) => {
      // 斷線時 ioredis 每次重連都會丟 error，一分鐘只記一次就好
      if (Date.now() - lastErrorLoggedAt > 60_000) {
        lastErrorLoggedAt = Date.now()
        console.error('[rate-limit] Redis 連線錯誤，節流暫時放行：', error.message)
      }
    })
    globalForRateLimit.rateLimitRedis = redis
  }
  return globalForRateLimit.rateLimitRedis
}

export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number }

function redisKey(key: string): string {
  return `rl:${key}`
}

/** 看目前是否已達上限，不計數。搭配 recordRateLimitHit 做「只算失敗」的節流。 */
export async function peekRateLimit(key: string, limit: number): Promise<RateLimitResult> {
  try {
    const k = redisKey(key)
    const [count, ttl] = await Promise.all([client().get(k), client().ttl(k)])
    if (Number(count ?? 0) >= limit) return { ok: false, retryAfterSeconds: Math.max(ttl, 1) }
    return { ok: true }
  } catch {
    return { ok: true }
  }
}

/** 計一次。視窗從第一次計數開始算，到期整個歸零。 */
export async function recordRateLimitHit(key: string, windowSeconds: number): Promise<number> {
  try {
    const k = redisKey(key)
    const count = await client().incr(k)
    if (count === 1) await client().expire(k, windowSeconds)
    return count
  } catch {
    return 0
  }
}

/** 計一次並判斷是否超過上限 —— 每次請求都算數的情況（例如索取簡訊）。 */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const count = await recordRateLimitHit(key, windowSeconds)
  if (count > limit) {
    try {
      const ttl = await client().ttl(redisKey(key))
      return { ok: false, retryAfterSeconds: Math.max(ttl, 1) }
    } catch {
      return { ok: false, retryAfterSeconds: windowSeconds }
    }
  }
  return { ok: true }
}

/**
 * 請求來源 IP。
 *
 * 只信 X-Real-IP：Caddy 用 `header_up X-Real-IP {remote_host}` 蓋掉客戶端送來的同名標頭，
 * 而 web 容器只綁 127.0.0.1，外面繞不過 Caddy。X-Forwarded-For 是「附加」而非覆寫，
 * 第一段可以由客戶端偽造，拿來節流等於讓人每次換一個 IP。
 */
export function clientIp(headers: Headers): string {
  return headers.get('x-real-ip')?.trim() || 'unknown'
}
