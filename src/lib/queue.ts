import 'server-only'
import { Queue, type JobsOptions } from 'bullmq'
import IORedis from 'ioredis'
import { env } from '@/lib/env'

/**
 * 背景工作佇列。
 *
 * 付款成功後要做的事（建物流單、開發票、寄信）都不該卡在 webhook 的回應裡 ——
 * 綠界只等幾秒就會判定逾時並重送。全部丟進佇列非同步做，webhook 立刻回 1|OK。
 */

export const QUEUE_NAME = 'sagon'

export type JobPayload = {
  'create-shipment': { orderId: string }
  'issue-invoice': { orderId: string }
  'send-email': {
    template: 'order-confirmed' | 'payment-info' | 'shipped' | 'order-cancelled'
    orderId: string
  }
  'release-expired-reservations': Record<string, never>
}

export type JobName = keyof JobPayload

const globalForQueue = globalThis as unknown as {
  redis?: IORedis
  queue?: Queue
}

export function getRedis(): IORedis {
  globalForQueue.redis ??= new IORedis(env.REDIS_URL, {
    // BullMQ 要求：阻塞式指令不能有重試上限
    maxRetriesPerRequest: null,
  })
  return globalForQueue.redis
}

export function getQueue(): Queue {
  globalForQueue.queue ??= new Queue(QUEUE_NAME, {
    connection: getRedis(),
    defaultJobOptions: {
      attempts: 5,
      // 綠界偶發性逾時很常見，用指數退避重試而不是立刻放棄
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  })
  return globalForQueue.queue
}

export async function enqueue<N extends JobName>(
  name: N,
  data: JobPayload[N],
  options?: JobsOptions,
): Promise<void> {
  try {
    await getQueue().add(name, data, options)
  } catch (error) {
    // Redis 掛掉不該讓 webhook 回失敗（否則綠界會一直重送同一筆）。
    // 記下來，由後台的 webhook 檢視頁補送。
    console.error(`[queue] 無法排入工作 ${name}：`, error)
  }
}

/**
 * 註冊定期工作。worker 啟動時呼叫一次即可，
 * BullMQ 會用 jobId 去重，重啟不會產生第二個排程。
 */
export async function registerRepeatableJobs(): Promise<void> {
  await getQueue().add(
    'release-expired-reservations',
    {},
    {
      repeat: { pattern: '*/5 * * * *' }, // 每 5 分鐘
      jobId: 'cron:release-expired-reservations',
      removeOnComplete: { count: 20 },
    },
  )
}
