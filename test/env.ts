/**
 * 測試用的假環境變數，讓 `@/lib/env` 的 zod 驗證通過。
 *
 * unit 與 integration 兩個 vitest project 共用這一份；
 * integration 只覆寫 DATABASE_URL 指向真實測試庫（見 vitest.config.ts）。
 * 金流三組 HashKey/IV 是綠界公開的測試商店憑證，不是機密。
 */
export const FAKE_TEST_ENV = {
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  AUTH_SECRET: 'test-secret-at-least-16-chars',
  ECPAY_ENV: 'stage',
  ECPAY_MERCHANT_ID: '3002607',
  ECPAY_HASH_KEY: 'pwFHCqoQZGmho4w6',
  ECPAY_HASH_IV: 'EkRm7iFT261dpevs',
  ECPAY_LOGISTICS_MERCHANT_ID: '2000933',
  ECPAY_LOGISTICS_HASH_KEY: 'XBERn1YOvpM9nfZc',
  ECPAY_LOGISTICS_HASH_IV: 'h1ONHk4P4yqbl5LK',
  ECPAY_SENDER_NAME: '測試商店',
  ECPAY_SENDER_CELLPHONE: '0912345678',
  ECPAY_SENDER_ZIPCODE: '104',
  ECPAY_SENDER_ADDRESS: '台北市中山區',
  ECPAY_RECEIPT_MERCHANT_ID: '2000132',
  ECPAY_RECEIPT_HASH_KEY: 'ejCk326UnaZWKisg',
  ECPAY_RECEIPT_HASH_IV: 'q9jcZX8Ib9LM8wYk',
  TCAT_ENV: 'stage',
  TCAT_CUSTOMER_ID: '1265635401',
  TCAT_CUSTOMER_TOKEN: 'test-token',
  // 黑貓郵碼固定六碼（規格書範例的格式），不是中華郵政郵遞區號
  TCAT_SENDER_ZIP: '12334L',
} as const

/**
 * 整合測試連的真實 Postgres。預設用 docker compose 的 db（host 15433），
 * 可用 TEST_DATABASE_URL 覆寫（例如多個 agent 平行跑各自的庫）。
 */
export function integrationDatabaseUrl(): string {
  return (
    process.env.TEST_DATABASE_URL ??
    'postgresql://sagon:sagon_dev_pw@localhost:15433/sagon_test'
  )
}
