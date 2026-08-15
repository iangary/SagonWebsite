import { defineConfig, devices } from '@playwright/test'

// 金流 E2E 需要 .env 裡的綠界測試金鑰來簽模擬回拋（Node 22 內建 loadEnvFile）。
// 已存在的環境變數優先，.env 不存在就跳過。
try {
  process.loadEnvFile?.('.env')
} catch {
  // 沒有 .env（例如 CI 用環境變數注入）就照常執行
}

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'

export default defineConfig({
  testDir: './test/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // 測試會共用同一份資料庫，序列執行避免互相干擾
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: BASE_URL,
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // 已經有 dev server 在跑就沿用，沒有才自己起一個
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
