import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    // 只跑單元測試，E2E 交給 Playwright
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    // 被測模組會 import '@/lib/env'，給它一組能通過 zod 驗證的假值
    env: {
      NODE_ENV: 'test',
      APP_URL: 'http://localhost:3000',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      REDIS_URL: 'redis://localhost:6379',
      AUTH_SECRET: 'test-secret-at-least-16-chars',
      ECPAY_ENV: 'stage',
      ECPAY_MERCHANT_ID: '3002607',
      ECPAY_HASH_KEY: 'pwFHCqoQZGmho4w6',
      ECPAY_HASH_IV: 'EkRm7iFT261dpevs',
      ECPAY_LOGISTICS_MERCHANT_ID: '2000132',
      ECPAY_LOGISTICS_HASH_KEY: '5294y06JbISpM5x9',
      ECPAY_LOGISTICS_HASH_IV: 'v77hoKGq4kWxNNIS',
      ECPAY_LOGISTICS_C2C_MERCHANT_ID: '2000933',
      ECPAY_LOGISTICS_C2C_HASH_KEY: 'XBERn1YOvpM9nfZc',
      ECPAY_LOGISTICS_C2C_HASH_IV: 'h1ONHk4P4yqbl5LK',
      ECPAY_SENDER_NAME: '測試商店',
      ECPAY_SENDER_CELLPHONE: '0912345678',
      ECPAY_SENDER_ZIPCODE: '104',
      ECPAY_SENDER_ADDRESS: '台北市中山區',
      ECPAY_INVOICE_MERCHANT_ID: '2000132',
      ECPAY_INVOICE_HASH_KEY: 'ejCk326UnaZWKisg',
      ECPAY_INVOICE_HASH_IV: 'q9jcZX8Ib9LM8wYk',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      // server-only 在 Next 的 bundler 外會直接拋錯，測試時換成空模組
      'server-only': path.resolve(import.meta.dirname, 'test/stubs/server-only.ts'),
    },
  },
})
