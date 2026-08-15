import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { FAKE_TEST_ENV, integrationDatabaseUrl } from './test/env'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      // server-only 在 Next 的 bundler 外會直接拋錯，測試時換成空模組
      'server-only': path.resolve(import.meta.dirname, 'test/stubs/server-only.ts'),
    },
  },
  test: {
    environment: 'node',
    // 整合測試每條前會 TRUNCATE 全部資料表，測試檔之間不能平行。
    // （fileParallelism 只能設在頂層；單元測試很快，序列化沒有感覺。）
    fileParallelism: false,
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
          testTimeout: 20_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
})
