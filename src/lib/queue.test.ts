import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * queue.ts 的單元測試：不連真的 Redis / Postgres。
 * bullmq 的 Queue、ioredis、@/lib/db 全部換成 mock，
 * 只驗證 enqueue 的參數傳遞與「失敗時落 AuditLog、絕不 throw」的契約。
 */

const { addMock, auditCreateMock } = vi.hoisted(() => ({
  addMock: vi.fn(),
  auditCreateMock: vi.fn(),
}))

vi.mock('bullmq', () => ({
  Queue: class MockQueue {
    add = addMock
  },
}))

vi.mock('ioredis', () => ({
  default: class MockRedis {},
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
  it('註冊兩個 cron job，jobId 穩定以便 BullMQ 去重', async () => {
    addMock.mockResolvedValue(undefined)

    await registerRepeatableJobs()

    expect(addMock).toHaveBeenCalledTimes(2)
    expect(addMock).toHaveBeenCalledWith(
      'release-expired-reservations',
      {},
      expect.objectContaining({
        jobId: 'cron:release-expired-reservations',
        repeat: { pattern: '*/5 * * * *' },
      }),
    )
    expect(addMock).toHaveBeenCalledWith(
      'poll-tcat-status',
      {},
      expect.objectContaining({
        jobId: 'cron:poll-tcat-status',
        repeat: { pattern: '*/30 * * * *' },
        attempts: 1,
      }),
    )
  })
})
