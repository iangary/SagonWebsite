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
  await db.$executeRawUnsafe(truncateSql)
})

afterAll(async () => {
  await db.$disconnect()
})
