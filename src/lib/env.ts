import 'server-only'
import { z } from 'zod'

/**
 * 伺服器端環境變數。啟動時就驗證，避免跑到結帳那一刻才發現綠界的 HashIV 沒設。
 * 這個模組不能被 middleware（edge runtime）匯入 —— 見 src/auth.config.ts。
 */

const boolish = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')

const intFromString = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : Number(v)))
    .pipe(z.number().int().nonnegative())

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  APP_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  AUTH_SECRET: z.string().min(16, 'AUTH_SECRET 至少要 16 字元，請用 openssl rand -base64 32 產生'),
  AUTH_GOOGLE_ID: z.string().optional().default(''),
  AUTH_GOOGLE_SECRET: z.string().optional().default(''),

  ECPAY_ENV: z.enum(['stage', 'production']).default('stage'),

  ECPAY_MERCHANT_ID: z.string().min(1),
  ECPAY_HASH_KEY: z.string().min(1),
  ECPAY_HASH_IV: z.string().min(1),

  ECPAY_LOGISTICS_MERCHANT_ID: z.string().min(1),
  ECPAY_LOGISTICS_HASH_KEY: z.string().min(1),
  ECPAY_LOGISTICS_HASH_IV: z.string().min(1),
  ECPAY_LOGISTICS_C2C_MERCHANT_ID: z.string().min(1),
  ECPAY_LOGISTICS_C2C_HASH_KEY: z.string().min(1),
  ECPAY_LOGISTICS_C2C_HASH_IV: z.string().min(1),

  ECPAY_SENDER_NAME: z.string().min(1),
  ECPAY_SENDER_PHONE: z.string().default(''),
  ECPAY_SENDER_CELLPHONE: z.string().min(1),
  ECPAY_SENDER_ZIPCODE: z.string().min(1),
  ECPAY_SENDER_ADDRESS: z.string().min(1),

  ECPAY_INVOICE_MERCHANT_ID: z.string().min(1),
  ECPAY_INVOICE_HASH_KEY: z.string().min(1),
  ECPAY_INVOICE_HASH_IV: z.string().min(1),
  ECPAY_INVOICE_AUTO_ISSUE: boolish.default(true),

  SMS_PROVIDER: z.enum(['console', 'mitake']).default('console'),
  MITAKE_USERNAME: z.string().optional().default(''),
  MITAKE_PASSWORD: z.string().optional().default(''),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: intFromString(1025),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  SMTP_SECURE: boolish.default(false),
  MAIL_FROM: z.string().default('莎岡選品店 <no-reply@sagon.local>'),

  SEED_SOURCE: z.string().optional().default(''),
  SEED_ADMIN_EMAIL: z.string().email().default('admin@sagon.local'),
  SEED_ADMIN_PASSWORD: z.string().min(6).default('admin1234'),

  SHOP_NAME: z.string().default('莎岡選品店'),
  SHOP_TAX_ID: z.string().default('93124857'),
  /** 通知信頁尾的客服信箱。要是收得到信的真信箱 —— 客戶會直接回信到這裡。 */
  SHOP_SERVICE_EMAIL: z.string().email().default('service@sagon.local'),
  SHIPPING_FEE_CVS: intFromString(60),
  SHIPPING_FEE_HOME: intFromString(120),
  FREE_SHIPPING_THRESHOLD: intFromString(1500),
  STOCK_RESERVATION_MINUTES: intFromString(30),
})

function load() {
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    throw new Error(`環境變數設定不完整：\n${issues}\n\n請對照 .env.example 補齊。`)
  }
  return parsed.data
}

export const env = load()
export type Env = typeof env

/** Google SSO 是選配：沒填 client id 就不要在登入頁顯示按鈕。 */
export const isGoogleAuthEnabled = Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET)
