import { afterAll, beforeAll, beforeEach } from 'vitest'
import { db } from '@/lib/db'

/**
 * 每條整合測試前把所有資料表清空，讓測試彼此獨立。
 *
 * 用 TRUNCATE 而不是把測試包在交易裡回滾：被測程式自己會開 interactive
 * $transaction（Prisma 6 沒有 savepoint），而且併發測試需要「不同連線上
 * 真正 commit 的交易」才能驗證鎖的行為 —— 回滾包裝會把這些全部弄假。
 */

let truncateSql = ''

beforeAll(async () => {
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `
  if (rows.length === 0) {
    throw new Error('測試庫裡沒有資料表 —— global-setup 的 migrate deploy 可能失敗了')
  }
  const tables = rows.map((r) => `"${r.tablename}"`).join(', ')
  truncateSql = `TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`
})

beforeEach(async () => {
  await truncateWithRetry()
})

/**
 * TRUNCATE 需要所有資料表的 AccessExclusiveLock，只要還有任何連線握著列鎖就會鎖死。
 *
 * 併發測試（搶庫存、重複回拋、重複評論）用 Promise.all 開多個交易，其中一個
 * 失敗時 Promise.all 會立刻 reject —— 另一個交易還在背景跑完，於是下一條測試
 * 的清庫就撞上它，隨機噴 40P01。與其要求每個測試都改用 allSettled，不如在這裡
 * 退讓重試：殘留的交易幾十毫秒內就會結束。
 */
async function truncateWithRetry(attempts = 10): Promise<void> {
  for (let i = 1; i <= attempts; i++) {
    try {
      await db.$executeRawUnsafe(truncateSql)
      return
    } catch (error) {
      const isDeadlock =
        error instanceof Error && /40P01|deadlock detected/i.test(`${error.message}`)
      if (!isDeadlock || i === attempts) throw error
      await new Promise((resolve) => setTimeout(resolve, 50 * i))
    }
  }
}

afterAll(async () => {
  await db.$disconnect()
})
