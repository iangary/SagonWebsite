import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { FAKE_TEST_ENV, integrationDatabaseUrl } from './test/env'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      // server-only 在 Next 的 bundler 外會直接拋錯，測試時換成空模組
      'server-only': path.resolve(import.meta.dirname, 'test/stubs/server-only.ts'),
      // next-intl/server 的真實實作只存在於 react-server 條件下；vitest 解析到的
      // client shim 一被呼叫就拋錯，換成用真 messages 建的預設語系 translator。
      'next-intl/server': path.resolve(import.meta.dirname, 'test/stubs/next-intl-server.ts'),
    },
  },
  test: {
    environment: 'node',
    projects: [
      {
        extends: true,
        test: {
          // 純函式單元測試：不碰資料庫，被測模組 import '@/lib/env' 時給假值
          name: 'unit',
          include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
          env: { ...FAKE_TEST_ENV },
        },
      },
      {
        extends: true,
        test: {
          // 整合測試：連真實 Postgres（docker compose 的 db），
          // 併發競態（搶庫存、重複回拋）必須在真的交易與鎖上才測得出來。
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          env: { ...FAKE_TEST_ENV, DATABASE_URL: integrationDatabaseUrl() },
          globalSetup: ['./test/integration/global-setup.ts'],
          setupFiles: ['./test/integration/setup.ts'],
          // 每條測試前會 TRUNCATE 全部資料表（AccessExclusiveLock），
          // 測試檔一旦平行跑就會和別檔的查詢鎖死（Postgres 40P01）。
          // 全部塞進同一個 fork 依序執行 —— 注意 fileParallelism 放在
          // 頂層對 project 不生效，一定要用 poolOptions 指定。
          poolOptions: { forks: { singleFork: true } },
          testTimeout: 20_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
})
