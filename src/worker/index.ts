/**
 * 背景工作處理程序。與 web 分開跑（docker compose 的 worker service）。
 *
 * 啟動：npm run worker
 */

import { Worker, type Job } from 'bullmq'
import { QUEUE_NAME, getRedis, registerRepeatableJobs, type JobName, type JobPayload } from '@/lib/queue'
import { db } from '@/lib/db'
import { createShipmentForOrder } from '@/lib/orders/logistics'
import { issueInvoiceForOrder } from '@/lib/orders/invoice'
import { releaseExpiredReservations } from '@/lib/orders/stock'
import { sendOrderEmail } from '@/lib/email'

const CONCURRENCY = 4

const handlers: {
  [N in JobName]: (data: JobPayload[N]) => Promise<unknown>
} = {
  'create-shipment': async ({ orderId }) => {
    await createShipmentForOrder(orderId)
    return { orderId }
  },

  'issue-invoice': async ({ orderId }) => {
    await issueInvoiceForOrder(orderId)
    return { orderId }
  },

  'send-email': async ({ template, orderId }) => {
    await sendOrderEmail(template, orderId)
    return { template, orderId }
  },

  'release-expired-reservations': async () => {
    const result = await releaseExpiredReservations()
    if (result.ordersCancelled > 0) {
      console.info(
        `[worker] 釋放逾期庫存：取消 ${result.ordersCancelled} 張訂單、還原 ${result.itemsReleased} 個品項`,
      )
      // 通知消費者訂單已取消
      const cancelled = await db.order.findMany({
        where: {
          status: 'CANCELLED',
          cancelledAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
        },
        select: { id: true },
      })
      for (const order of cancelled) {
        await sendOrderEmail('order-cancelled', order.id).catch((err) =>
          console.error('[worker] 取消通知信寄送失敗', err),
        )
      }
    }
    return result
  },
}

async function main() {
  console.info('[worker] 啟動中…')

  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      const handler = handlers[job.name as JobName]
      if (!handler) throw new Error(`未知的工作類型：${job.name}`)
      // 型別在 handlers 的定義上已經對齊，這裡的斷言只是為了跨越 BullMQ 的 any
      return handler(job.data as never)
    },
    {
      connection: getRedis(),
      concurrency: CONCURRENCY,
    },
  )

  worker.on('completed', (job) => {
    console.info(`[worker] ✓ ${job.name} (${job.id})`)
  })

  worker.on('failed', (job, err) => {
    const attempts = job ? `${job.attemptsMade}/${job.opts.attempts ?? 1}` : '?'
    console.error(`[worker] ✗ ${job?.name} (${job?.id}) 第 ${attempts} 次嘗試失敗：${err.message}`)
  })

  await registerRepeatableJobs()
  console.info(`[worker] 已就緒，concurrency=${CONCURRENCY}`)

  // 收到停止訊號時先把手上的工作做完再退出，避免工作被中斷成半套狀態
  const shutdown = async (signal: string) => {
    console.info(`[worker] 收到 ${signal}，正在收工…`)
    await worker.close()
    await db.$disconnect()
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((err) => {
  console.error('[worker] 啟動失敗：', err)
  process.exit(1)
})
