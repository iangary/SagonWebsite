/**
 * 手動把一個背景工作丟進佇列。用於：
 *   - 驗證 SMTP／綠界設定是否正確
 *   - 補跑因為外部服務暫時掛掉而失敗的工作
 *
 * 用法：
 *   npx tsx --env-file-if-exists=.env --conditions=react-server scripts/enqueue-job.ts <job> <orderId> [template]
 *
 * 範例：
 *   ... scripts/enqueue-job.ts send-email <orderId> order-confirmed
 *   ... scripts/enqueue-job.ts create-shipment <orderId>
 *   ... scripts/enqueue-job.ts issue-invoice <orderId>
 *   ... scripts/enqueue-job.ts release-expired-reservations
 */

import { Queue } from 'bullmq'
import IORedis from 'ioredis'

const JOB_NAMES = [
  'send-email',
  'create-shipment',
  'issue-invoice',
  'release-expired-reservations',
] as const

type JobName = (typeof JOB_NAMES)[number]

const [, , jobArg, orderId, template = 'order-confirmed'] = process.argv

function usage(message: string): never {
  console.error(`${message}\n\n可用的工作：${JOB_NAMES.join('、')}`)
  process.exit(1)
}

if (!jobArg || !JOB_NAMES.includes(jobArg as JobName)) {
  usage(`請指定工作名稱（收到：${jobArg ?? '無'}）`)
}
const job = jobArg as JobName

if (job !== 'release-expired-reservations' && !orderId) {
  usage(`${job} 需要指定 orderId`)
}

const redisUrl = process.env.REDIS_URL
if (!redisUrl) usage('缺少 REDIS_URL 環境變數')

const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null })
const queue = new Queue('sagon', { connection })

const data =
  job === 'send-email'
    ? { template, orderId }
    : job === 'release-expired-reservations'
      ? {}
      : { orderId }

await queue.add(job, data, { attempts: 3, backoff: { type: 'exponential', delay: 3000 } })
console.log(`已排入 ${job}`, data)

await queue.close()
await connection.quit()
