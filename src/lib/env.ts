import 'server-only'
import { z } from 'zod'

import type { SsoProviderId } from '@/lib/auth/sso'

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
  // LINE Login channel 的 Channel ID / Channel secret（不是 Messaging API 那組）
  AUTH_LINE_ID: z.string().optional().default(''),
  AUTH_LINE_SECRET: z.string().optional().default(''),
  // Meta 應用程式的「應用程式編號」與「應用程式密鑰」
  AUTH_FACEBOOK_ID: z.string().optional().default(''),
  AUTH_FACEBOOK_SECRET: z.string().optional().default(''),

  ECPAY_ENV: z.enum(['stage', 'production']).default('stage'),

  ECPAY_MERCHANT_ID: z.string().min(1),
  ECPAY_HASH_KEY: z.string().min(1),
  ECPAY_HASH_IV: z.string().min(1),

  // 只做超商 C2C，綠界不會核發第二組物流代號
  ECPAY_LOGISTICS_MERCHANT_ID: z.string().min(1),
  ECPAY_LOGISTICS_HASH_KEY: z.string().min(1),
  ECPAY_LOGISTICS_HASH_IV: z.string().min(1),

  ECPAY_SENDER_NAME: z.string().min(1),
  ECPAY_SENDER_PHONE: z.string().default(''),
  ECPAY_SENDER_CELLPHONE: z.string().min(1),
  ECPAY_SENDER_ZIPCODE: z.string().min(1),
  ECPAY_SENDER_ADDRESS: z.string().min(1),

  // 電子收據。不是統一發票 —— 紙本發票另由人工開立隨包裹寄出。
  ECPAY_RECEIPT_MERCHANT_ID: z.string().min(1),
  ECPAY_RECEIPT_HASH_KEY: z.string().min(1),
  ECPAY_RECEIPT_HASH_IV: z.string().min(1),
  ECPAY_RECEIPT_AUTO_ISSUE: boolish.default(true),

  // 黑貓宅急便（統一速達印單 API 平台）。宅配是我們自己簽的約，不經綠界。
  TCAT_ENV: z.enum(['stage', 'production']).default('stage'),
  TCAT_CUSTOMER_ID: z.string().min(1),
  TCAT_CUSTOMER_TOKEN: z.string().min(1),
  /**
   * 寄件地址對應的「黑貓郵碼」後六碼 —— 不是中華郵政的郵遞區號。
   * 用 scripts/tcat-parse-address.ts 查一次寫進來即可，地址沒變就不會變。
   */
  TCAT_SENDER_ZIP: z.string().length(6),
  /** 託運單版型：01 A4 二模、02 A4 三模、03 熱轉印 */
  TCAT_OBT_TYPE: z.enum(['01', '02', '03']).default('01'),
  /** 商品類別，見規格書 2.2.1 第 32 項。0008 = 服飾配件 */
  TCAT_PRODUCT_TYPE_ID: z.string().length(4).default('0008'),
  /** 材積級距：0001 60cm、0002 90cm、0003 120cm、0004 150cm */
  TCAT_DEFAULT_SPEC: z.enum(['0001', '0002', '0003', '0004']).default('0002'),
  /**
   * 每滿這個件數就把材積往上升一級。預設極大值 = 一律用 TCAT_DEFAULT_SPEC。
   * 之後要調整級距規則改這個值就好，不用動程式。
   */
  TCAT_SPEC_QTY_STEP: intFromString(9999),

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
  /** 英文站的店名。前台的 logo、頁尾、關於頁都依語系挑這一個。 */
  SHOP_NAME_EN: z.string().default('Sagan Select'),
  SHOP_TAX_ID: z.string().default('93124857'),
  /** 通知信頁尾的客服信箱。要是收得到信的真信箱 —— 客戶會直接回信到這裡。 */
  SHOP_SERVICE_EMAIL: z.string().email().default('ian890711@gmail.com'),
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

/**
 * SSO 全是選配：沒填憑證的 provider 不會註冊，登入頁也不顯示按鈕。
 * 這樣本機開發不用湊齊所有第三方帳號也能跑。
 */
export const enabledSsoProviders: SsoProviderId[] = [
  ...(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET ? (['google'] as const) : []),
  ...(env.AUTH_LINE_ID && env.AUTH_LINE_SECRET ? (['line'] as const) : []),
  ...(env.AUTH_FACEBOOK_ID && env.AUTH_FACEBOOK_SECRET ? (['facebook'] as const) : []),
]

export const isGoogleAuthEnabled = enabledSsoProviders.includes('google')
export const isLineAuthEnabled = enabledSsoProviders.includes('line')
export const isFacebookAuthEnabled = enabledSsoProviders.includes('facebook')
