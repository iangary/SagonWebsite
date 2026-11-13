import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * queue.ts 的單元測試：不連真的 Redis / Postgres。
 * bullmq 的 Queue、ioredis、@/lib/db 全部換成 mock，
 * 只驗證 enqueue 的參數傳遞與「失敗時落 AuditLog、絕不 throw」的契約。
 */

const { addMock, auditCreateMock, upsertMock, removeSchedulerMock, zrangeMock } = vi.hoisted(
  () => ({
    addMock: vi.fn(),
    auditCreateMock: vi.fn(),
    upsertMock: vi.fn(),
    removeSchedulerMock: vi.fn(),
    zrangeMock: vi.fn(),
  }),
)

vi.mock('bullmq', () => ({
  Queue: class MockQueue {
    add = addMock
    upsertJobScheduler = upsertMock
    removeJobScheduler = removeSchedulerMock
  },
}))

vi.mock('ioredis', () => ({
  default: class MockRedis {
    zrange = zrangeMock
  },
}))

vi.mock('@/lib/db', () => ({
  db: { auditLog: { create: auditCreateMock } },
}))

import { enqueue, registerRepeatableJobs } from './queue'

// queue.ts 把 Queue/Redis 實例快取在 globalThis 上，測試之間要清掉
const globalForQueue = globalThis as unknown as { redis?: unknown; queue?: unknown }

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  delete globalForQueue.redis
  delete globalForQueue.queue
  addMock.mockReset()
  auditCreateMock.mockReset()
  upsertMock.mockReset()
  removeSchedulerMock.mockReset()
  zrangeMock.mockReset().mockResolvedValue([])
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
})

describe('enqueue', () => {
  it('成功時把 name/data/options 原封不動交給 Queue.add', async () => {
    addMock.mockResolvedValue(undefined)

    await enqueue('create-shipment', { orderId: 'order-1' }, { delay: 3000 })

    expect(addMock).toHaveBeenCalledOnce()
    expect(addMock).toHaveBeenCalledWith('create-shipment', { orderId: 'order-1' }, { delay: 3000 })
    expect(auditCreateMock).not.toHaveBeenCalled()
  })

  it('Queue.add 失敗時不 throw：印 error 並落一筆 enqueue-failed 的 AuditLog', async () => {
    addMock.mockRejectedValue(new Error('Redis 掛了'))
    auditCreateMock.mockResolvedValue({})

    await expect(enqueue('issue-receipt', { orderId: 'order-2' })).resolves.toBeUndefined()

    expect(consoleError).toHaveBeenCalledOnce()
    expect(auditCreateMock).toHaveBeenCalledOnce()
    expect(auditCreateMock).toHaveBeenCalledWith({
      data: {
        action: 'enqueue-failed',
        entity: 'queue-job',
        entityId: 'order-2',
        after: {
          job: 'issue-receipt',
          data: { orderId: 'order-2' },
          error: 'Redis 掛了',
        },
      },
    })
  })

  it('data 沒有 orderId 時 entityId 為 null', async () => {
    addMock.mockRejectedValue(new Error('connection refused'))
    auditCreateMock.mockResolvedValue({})

    await enqueue('release-expired-reservations', {})

    expect(auditCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'enqueue-failed',
        entityId: null,
        after: expect.objectContaining({ job: 'release-expired-reservations' }),
      }),
    })
  })

  it('AuditLog 也寫失敗時仍不 throw，只剩第二個 console.error', async () => {
    addMock.mockRejectedValue(new Error('Redis 掛了'))
    auditCreateMock.mockRejectedValue(new Error('資料庫也掛了'))

    await expect(enqueue('send-email', { template: 'shipped', orderId: 'order-3' })).resolves
      .toBeUndefined()

    expect(consoleError).toHaveBeenCalledTimes(2)
  })
})

describe('registerRepeatableJobs', () => {
  it('用固定 id 的 Job Scheduler 註冊四個定期工作，重啟不會多出排程', async () => {
    await registerRepeatableJobs()

    expect(upsertMock).toHaveBeenCalledTimes(4)
    expect(upsertMock).toHaveBeenCalledWith(
      'cron:release-expired-reservations',
      { pattern: '*/5 * * * *' },
      { name: 'release-expired-reservations', data: {}, opts: { removeOnComplete: { count: 20 } } },
    )
    expect(upsertMock).toHaveBeenCalledWith(
      'cron:reconcile-payments',
      { pattern: '*/15 * * * *' },
      expect.objectContaining({
        name: 'reconcile-payments',
        opts: expect.objectContaining({ attempts: 1 }),
      }),
    )
    expect(upsertMock).toHaveBeenCalledWith(
      'cron:poll-tcat-status',
      { pattern: '*/30 * * * *' },
      expect.objectContaining({
        name: 'poll-tcat-status',
        opts: expect.objectContaining({ attempts: 1 }),
      }),
    )
    expect(upsertMock).toHaveBeenCalledWith(
      'cron:send-review-invites',
      // 每天早上 10 點 —— 凌晨寄行銷信被標垃圾的機率高得多
      { pattern: '0 10 * * *' },
      expect.objectContaining({
        name: 'send-review-invites',
        opts: expect.objectContaining({ attempts: 1 }),
      }),
    )
    // 舊的 queue.add(..., { repeat }) 寫法在 BullMQ 6 已移除
    expect(addMock).not.toHaveBeenCalled()
  })

  it('清掉 BullMQ 5 留下的舊式排程（32 字元雜湊），不動新的 Job Scheduler', async () => {
    const legacy = 'da4ae745a70edcf90fd640f93d091fd7'
    zrangeMock.mockResolvedValue([legacy, 'cron:reconcile-payments', 'not-a-hash'])

    await registerRepeatableJobs()

    expect(removeSchedulerMock).toHaveBeenCalledTimes(1)
    expect(removeSchedulerMock).toHaveBeenCalledWith(legacy)
    expect(upsertMock).toHaveBeenCalledTimes(4)
  })

  it('清舊排程失敗不會擋住新排程註冊（worker 照常啟動）', async () => {
    zrangeMock.mockRejectedValue(new Error('redis down'))

    await expect(registerRepeatableJobs()).resolves.toBeUndefined()
    expect(upsertMock).toHaveBeenCalledTimes(4)
    expect(consoleError).toHaveBeenCalledWith(
      '[queue] 清除舊式 repeatable 排程失敗，略過：',
      expect.any(Error),
    )
  })
})
