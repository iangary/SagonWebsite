/**
 * 推薦 API 的頻率限制（Redis）。
 *
 * 比對本身很便宜，限制是為了擋腳本把整張適穿對照表一格一格掃出來，
 * 以及避免有人用大量請求拖慢資料庫。只依賴 Redis 指令的最小介面，測試可以塞記憶體假物件。
 */

export interface RedisLike {
  incr(key: string): Promise<number>
  expire(key: string, seconds: number): Promise<number>
}

/** 每個 IP 在 RATE_WINDOW_SECONDS 內最多查幾次。顧客改幾次數字綽綽有餘，掃表的腳本會被擋。 */
export const RATE_LIMIT = 20
export const RATE_WINDOW_SECONDS = 10 * 60

const KEY_PREFIX = 'recommend:v2'

/**
 * 固定時間窗計數。時間窗的編號放在 key 裡，第一次 INCR 時設過期只是為了清垃圾 ——
 * 就算 EXPIRE 失敗，下一個時間窗也是新的 key，不會把這個 IP 永遠鎖住。
 */
export async function hitRateLimit(
  redis: RedisLike,
  ip: string,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  const window = Math.floor(now / 1000 / RATE_WINDOW_SECONDS)
  const key = `${KEY_PREFIX}:rate:${ip}:${window}`
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, RATE_WINDOW_SECONDS)
  if (count <= RATE_LIMIT) return { ok: true }
  const windowEnd = (window + 1) * RATE_WINDOW_SECONDS
  return { ok: false, retryAfterSeconds: Math.max(1, windowEnd - Math.floor(now / 1000)) }
}

/**
 * Redis 指令加上時限。lib/queue.ts 的連線是給 BullMQ 用的（maxRetriesPerRequest: null），
 * Redis 掛掉時指令會無限期排隊 —— 推薦 API 不能因此卡住，逾時就當 Redis 不可用。
 */
export function withTimeout(redis: RedisLike, ms: number): RedisLike {
  const race = <T>(promise: Promise<T>) =>
    Promise.race([
      promise,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Redis 逾時')), ms)),
    ])
  return {
    incr: (key) => race(redis.incr(key)),
    expire: (key, seconds) => race(redis.expire(key, seconds)),
  }
}

/** 走 Caddy 反向代理時，真實 IP 在 x-forwarded-for 的第一段（與 lib/audit.ts 相同） */
export function clientIp(headers: Headers): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip')?.trim() ||
    'unknown'
  )
}
