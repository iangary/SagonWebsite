import 'server-only'
import { Queue, type JobsOptions } from 'bullmq'
import IORedis from 'ioredis'
import { env } from '@/lib/env'
// 只取型別，不會把 nodemailer 帶進呼叫端
import type { EmailTemplate } from '@/lib/email'

/**
 * 背景工作佇列。
 *
 * 付款成功後要做的事（建物流單、開收據、寄信）都不該卡在 webhook 的回應裡 ——
 * 綠界只等幾秒就會判定逾時並重送。全部丟進佇列非同步做，webhook 立刻回 1|OK。
 */

export const QUEUE_NAME = 'sagon'

export type JobPayload = {
  'create-shipment': { orderId: string }
  'issue-receipt': { orderId: string }
  'send-email': {
    template: EmailTemplate
    orderId: string
    /** 退款相關的信件要知道是哪一筆申請 */
    refundId?: string
  }
  'release-expired-reservations': Record<string, never>
  /** 黑貓沒有貨態回拋，只能定期去問 */
  'poll-tcat-status': Record<string, never>
  /**
   * 主動向綠界查詢待付款訂單的真實狀態。
   * ReturnURL 漏掉（CDN、憑證、主機重啟）時，訂單會卡在待付款而消費者已經繳費，
   * 這支排程就是那種情況的唯一救援。
   */
  'reconcile-payments': Record<string, never>
  /** 出貨完成滿 N 天的訂單，寄一封評論邀請信（見 lib/orders/review-invite.ts） */
  'send-review-invites': Record<string, never>
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
    // 但也不能只印 log 就算了 —— 付款成功後的建物流單/開收據/寄信
    // 若無聲消失，訂單會卡死沒人知道。落一筆 AuditLog 當持久紀錄，
    // 供人工用 scripts/enqueue-job.ts 補送。
    console.error(`[queue] 無法排入工作 ${name}：`, error)
    try {
      const { db } = await import('@/lib/db')
      await db.auditLog.create({
        data: {
          action: 'enqueue-failed',
          entity: 'queue-job',
          entityId: 'orderId' in data ? (data as { orderId: string }).orderId : null,
          after: { job: name, data, error: error instanceof Error ? error.message : String(error) },
        },
      })
    } catch (auditError) {
      // 連資料庫都寫不進去就真的只剩 log 了
      console.error('[queue] enqueue-failed 稽核紀錄寫入失敗：', auditError)
    }
  }
}

/**
 * 定期工作的排程。key 就是 BullMQ Job Scheduler 的 id，固定不變，
 * 重啟 worker 時 upsert 同一個 id 只會更新、不會多出第二個排程。
 */
const SCHEDULES: {
  id: string
  name: JobName
  pattern: string
  opts: Pick<JobsOptions, 'attempts' | 'removeOnComplete'>
}[] = [
  {
    id: 'cron:release-expired-reservations',
    name: 'release-expired-reservations',
    pattern: '*/5 * * * *', // 每 5 分鐘
    opts: { removeOnComplete: { count: 20 } },
  },
  {
    id: 'cron:reconcile-payments',
    name: 'reconcile-payments',
    // 每 15 分鐘查一批（一批最多 20 筆，同一筆至少隔 30 分鐘才再查）。
    // 綠界對 API 有限速，太密會收到 403。
    pattern: '*/15 * * * *',
    opts: { attempts: 1, removeOnComplete: { count: 20 } },
  },
  {
    id: 'cron:poll-tcat-status',
    name: 'poll-tcat-status',
    // 每 30 分鐘一批（每批最多 10 張單）。黑貓限制同一張單 2 小時只能查一次，
    // 而且每日總量上限 3,000 次，這個頻率離上限還很遠。
    // 查貨態失敗就等下一輪，不需要重試堆積
    pattern: '*/30 * * * *',
    opts: { attempts: 1, removeOnComplete: { count: 20 } },
  },
  {
    id: 'cron:send-review-invites',
    name: 'send-review-invites',
    /*
     * 每天早上 10 點寄一批。
     *
     * 刻意不在半夜寄 —— 收件匣裡凌晨三點的行銷信被標垃圾的機率高得多，
     * 而且這封信本來就沒有時效性。時區跟著容器的 TZ 走。
     * 寄失敗的個別訂單會自己解除標記等下一輪，不需要整批重試。
     */
    pattern: '0 10 * * *',
    opts: { attempts: 1, removeOnComplete: { count: 20 } },
  },
]

/**
 * 清掉 BullMQ 5 舊式 repeatable job 留在 Redis 的排程。
 *
 * BullMQ 6 移除了舊的 `queue.add(..., { repeat })` 寫法（改用 Job Scheduler），也拿掉了
 * 清除舊排程用的 API。舊排程和新的 Job Scheduler 共用 `bull:<queue>:repeat` 這個 sorted set：
 * 舊的成員是一串 32 字元的雜湊、新的是上面 SCHEDULES 的 id，所以可以準確分辨。
 * 不清的話，舊排程已經排好的下一次工作還會跑一次，和新排程重複（工作都是冪等的，不會出錯，
 * 但多跑一次沒有意義），Redis 也會留著用不到的資料。
 *
 * 每次 worker 啟動都會跑，清完之後就是空操作。
 */
async function removeLegacyRepeatables(): Promise<number> {
  const queue = getQueue()
  const schedulerIds = new Set(SCHEDULES.map((s) => s.id))
  const members = await getRedis().zrange(`bull:${QUEUE_NAME}:repeat`, 0, -1)
  const legacy = members.filter((m) => !schedulerIds.has(m) && /^[0-9a-f]{32}$/.test(m))

  // 舊排程在 Redis 裡的形狀和 Job Scheduler 一樣（repeat:<id> 的 hash ＋ 下一次的
  // repeat:<id>:<時間戳> 工作），所以直接用 BullMQ 自己的 removeJobScheduler 一起刪掉。
  // 不能用 job.remove() 刪那筆排好的工作 —— BullMQ 6 會拒絕（屬於排程的工作不能單獨刪）。
  for (const id of legacy) await queue.removeJobScheduler(id)
  return legacy.length
}

/**
 * 註冊定期工作。worker 啟動時呼叫一次即可，
 * 用固定 id 的 Job Scheduler，重啟不會產生第二個排程。
 */
export async function registerRepeatableJobs(): Promise<void> {
  // 清舊排程失敗不能擋住 worker 啟動 —— 最壞情況只是舊排程多跑一次（工作都是冪等的）
  try {
    const removed = await removeLegacyRepeatables()
    if (removed > 0) console.info(`[queue] 已清除 ${removed} 個舊式 repeatable 排程`)
  } catch (error) {
    console.error('[queue] 清除舊式 repeatable 排程失敗，略過：', error)
  }

  for (const schedule of SCHEDULES) {
    await getQueue().upsertJobScheduler(
      schedule.id,
      { pattern: schedule.pattern },
      { name: schedule.name, data: {}, opts: schedule.opts },
    )
  }
}
