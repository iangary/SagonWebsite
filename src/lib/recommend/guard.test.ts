import { describe, expect, it } from 'vitest'
import { clientIp, hitRateLimit, RATE_LIMIT, RATE_WINDOW_SECONDS, withTimeout, type RedisLike } from './guard'

function fakeRedis(): RedisLike & { store: Map<string, number>; ttl: Map<string, number> } {
  const store = new Map<string, number>()
  const ttl = new Map<string, number>()
  return {
    store,
    ttl,
    async incr(key) {
      const n = (store.get(key) ?? 0) + 1
      store.set(key, n)
      return n
    },
    async expire(key, seconds) {
      ttl.set(key, seconds)
      return 1
    },
  }
}

describe('hitRateLimit', () => {
  it(`同一 IP 在時間窗內第 ${RATE_LIMIT + 1} 次被擋，並告知何時可再試`, async () => {
    const redis = fakeRedis()
    const now = 1_700_000_000_000
    for (let i = 0; i < RATE_LIMIT; i++) {
      expect(await hitRateLimit(redis, '1.2.3.4', now)).toEqual({ ok: true })
    }
    const blocked = await hitRateLimit(redis, '1.2.3.4', now)
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) {
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0)
      expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(RATE_WINDOW_SECONDS)
    }
    // 其他 IP 不受影響；下一個時間窗解鎖
    expect(await hitRateLimit(redis, '5.6.7.8', now)).toEqual({ ok: true })
    expect(await hitRateLimit(redis, '1.2.3.4', now + RATE_WINDOW_SECONDS * 1000)).toEqual({ ok: true })
  })

  it('只在第一次計數時設過期', async () => {
    const redis = fakeRedis()
    await hitRateLimit(redis, 'ip', 0)
    await hitRateLimit(redis, 'ip', 0)
    expect([...redis.ttl.values()]).toEqual([RATE_WINDOW_SECONDS])
  })
})

describe('withTimeout', () => {
  it('Redis 沒回應時在時限內丟錯，不會讓 API 卡住', async () => {
    const hanging: RedisLike = {
      incr: () => new Promise(() => {}),
      expire: () => new Promise(() => {}),
    }
    await expect(withTimeout(hanging, 20).incr('k')).rejects.toThrow('Redis 逾時')
  })
})

describe('clientIp', () => {
  it('取 x-forwarded-for 的第一段', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1' }))).toBe('9.9.9.9')
    expect(clientIp(new Headers({ 'x-real-ip': '8.8.8.8' }))).toBe('8.8.8.8')
    expect(clientIp(new Headers())).toBe('unknown')
  })
})
