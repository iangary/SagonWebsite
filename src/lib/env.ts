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

/**
 * 匯出給測試用：src/lib/env.test.ts 會拿 Dockerfile builder 階段設的環境變數
 * 餵給這個 schema，確保「新增必填變數卻忘了補 Dockerfile」在本機就會紅，
 * 而不是等 CI 建置到一半才失敗（這個坑已經踩過一次）。
 */
export const envSchema = z.object({
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
  /**
   * 呼叫黑貓來收貨（規格 2.6）時填的聯絡人。留白就沿用 ECPAY_SENDER_*，
   * 因為收貨地點本來就是寄件地址 —— 只有「找誰」跟寄件人不同時才需要設。
   */
  TCAT_PICKUP_CONTACT_NAME: z.string().optional().default(''),
  /** 聯絡人性別代碼：01 男、02 女。黑貓標為非必填，留白即可 */
  TCAT_PICKUP_CONTACT_GENDER: z.enum(['', '01', '02']).default(''),
  /** 司機出發前是否先打電話 */
  TCAT_PICKUP_IS_CONTACT: boolish.default(true),
  /** 司機是否要帶推車（件數多、或要下樓搬時才需要） */
  TCAT_PICKUP_IS_TROLLEY: boolish.default(false),

  SMS_PROVIDER: z.enum(['console', 'mitake']).default('console'),
  MITAKE_USERNAME: z.string().optional().default(''),
  /**
   * 注意：三竹的 API 密碼就是網頁後台的登入密碼，沒有獨立的 API 金鑰。
   * 在三竹後台改了密碼，這裡沒跟著改就會靜靜地回 statuscode=e，簡訊全部發不出去。
   */
  MITAKE_PASSWORD: z.string().optional().default(''),
  /**
   * 三竹端點的 base URL（不含 /SmSend 這類方法名）。
   * 預設值是三竹 2026-08-22 回覆指定給我們的「二站」B2C 端點 ——
   * 網域與路徑都不能猜：/b2c/mtk/ 是 B2C 版、/api/mtk/ 是企業版，
   * 帳號開通在哪一組就只能打哪一組，打錯是 404 或權限錯誤。
   * 詳見 docs/三竹/mitake-reply-api-provisioned.md。
   */
  MITAKE_ENDPOINT: z.string().url().default('https://smsb2c.mitake.com.tw/b2c/mtk'),

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
  const parsed = envSchema.safeParse(process.env)
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
