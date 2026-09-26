import 'server-only'
import { cache } from 'react'
import { z } from 'zod'
import { db } from '@/lib/db'

/**
 * 後台可改的營運設定（付款、運費）。
 *
 * 與 shop-config.ts 的分工：那裡是「部署層」的設定（金鑰、網域、店名），
 * 改了要重新部署；這裡是「營運層」的設定（要不要開放貨到付款、繳費期限幾天、運費多少），
 * 店長在後台就能改，存在 shop_settings 這張表。
 *
 * 值用 zod 解析並補預設值 —— 加欄位不必跑 migration，舊資料少一欄也不會壞。
 */

// ── 運費 ──

export const SHIPPING_SETTINGS_KEY = 'shipping'

export const shippingSettingsSchema = z.object({
  /**
   * 超商取貨運費（元）。預設 65 是綠界超商取貨的實收價 ——
   * 設得比它低，差額就是店家自己吸收。
   */
  cvsFee: z.number().int().min(0).max(1000).default(65),
  /** 宅配運費（元）。預設 130 是黑貓宅急便本島常溫的起價，離島與大件另計。 */
  homeFee: z.number().int().min(0).max(1000).default(130),
  /** 單筆商品金額（折扣後）滿這個數字免運，見 lib/orders/pricing.ts */
  freeShippingThreshold: z.number().int().min(1).max(100_000).default(2000),
})

export type ShippingSettings = z.infer<typeof shippingSettingsSchema>

export const DEFAULT_SHIPPING_SETTINGS: ShippingSettings = shippingSettingsSchema.parse({})

/**
 * 讀出運費設定。沒有紀錄或內容壞掉時回預設值。
 *
 * 用 React cache() 包住：公告列在每一頁都會讀，同一個 request 裡商品頁、
 * JSON-LD 又各讀一次，這樣只查一次資料庫。刻意不做跨 request 的快取 ——
 * 這是主鍵查詢，而後台改完運費就該立刻看到。
 */
export const getShippingSettings = cache(async (): Promise<ShippingSettings> => {
  return readSetting(SHIPPING_SETTINGS_KEY, shippingSettingsSchema, DEFAULT_SHIPPING_SETTINGS, '運費')
})

export async function saveShippingSettings(
  input: ShippingSettings,
  updatedById: string,
): Promise<void> {
  await writeSetting(SHIPPING_SETTINGS_KEY, input, updatedById)
}

/** 轉成 calculatePricing 要的 { CVS, HOME } 形狀 */
export function shippingFeesOf(settings: ShippingSettings): { CVS: number; HOME: number } {
  return { CVS: settings.cvsFee, HOME: settings.homeFee }
}

// ── 付款 ──

export const PAYMENT_SETTINGS_KEY = 'payment'

/** 綠界超商取貨付款的代收金額上限（GoodsAmount 1~20,000，超過建單會被退 10500040） */
export const CVS_COLLECTION_MAX = 20_000

/** 線上付款方式的預設值：全部開放。 */
const ONLINE_METHOD_DEFAULTS = {
  Credit: true,
  ATM: true,
  CVS: true,
  BARCODE: true,
} as const

export const paymentSettingsSchema = z.object({
  /** 線上付款（信用卡／ATM／超商代碼／超商條碼）。全關掉等於只做貨到付款。 */
  prepayEnabled: z.boolean().default(true),
  /** 個別開關線上付款方式，讓店長能只留信用卡或只留超商 */
  methods: z
    .object({
      Credit: z.boolean(),
      ATM: z.boolean(),
      CVS: z.boolean(),
      BARCODE: z.boolean(),
    })
    .partial()
    .transform((methods) => ({ ...ONLINE_METHOD_DEFAULTS, ...methods }))
    .default(ONLINE_METHOD_DEFAULTS),

  /** 貨到付款。錢由物流代收（超商取貨付款 / 黑貓代收貨款），不經綠界金流。 */
  codEnabled: z.boolean().default(false),
  /** 哪些配送方式可以貨到付款。超商與宅配是兩套代收機制，可以只開一邊。 */
  codShippingMethods: z.array(z.enum(['CVS', 'HOME'])).default(['CVS', 'HOME']),
  /** 貨到付款手續費（元）。0 = 不加收。 */
  codFee: z.number().int().min(0).max(1000).default(0),
  /** 貨到付款的訂單金額上限。超商代收上限是綠界規定的 20,000。 */
  codMaxAmount: z.number().int().min(1).max(100_000).default(CVS_COLLECTION_MAX),

  /**
   * 匯款到公司帳戶。錢直接進公司的銀行帳戶，不經綠界 ——
   * 代表**沒有任何自動入帳通知**，一定要有人去看帳戶再到後台按「標記匯款已入帳」
   * （見 lib/orders/payment.ts 的 markBankTransferPaid）。
   *
   * 帳戶資訊存在這裡而不是環境變數：換帳號不必重新部署。
   */
  bankTransferEnabled: z.boolean().default(false),
  /** 銀行（含分行），例如「玉山銀行 內湖分行」 */
  bankName: z.string().trim().max(60).default(''),
  /** 銀行代號，轉帳一定要，3 碼（郵局是 700） */
  bankCode: z.string().trim().max(10).default(''),
  bankAccountNo: z.string().trim().max(30).default(''),
  /** 戶名。客人要核對收款人是誰才敢轉。 */
  bankAccountName: z.string().trim().max(60).default(''),
  /** 匯款期限（天）。與超商／ATM 一樣，期限就是庫存要保留的時間。 */
  bankExpireDays: z.number().int().min(1).max(30).default(3),
  /** 給客人的補充說明，例如「請在轉帳備註填訂單編號」。空的就不顯示。 */
  bankTransferNote: z.string().trim().max(300).default(''),

  /**
   * 超商代碼／條碼的繳費期限（天）。綠界上限 30 天。
   * 期限拉長代表庫存也要跟著保留同樣長的時間（否則會出現「繳了費卻沒貨」）。
   */
  cvsExpireDays: z.number().int().min(1).max(30).default(2),
  /** ATM 虛擬帳號的付款期限（天）。綠界的單位就是天，下限 1 天。 */
  atmExpireDays: z.number().int().min(1).max(30).default(2),
  /**
   * 信用卡訂單保留庫存的分鐘數。信用卡當場刷完，這段時間只是讓消費者
   * 在綠界付款頁填卡號、過 3D 驗證；逾時未付就取消並釋放庫存。
   */
  creditHoldMinutes: z.number().int().min(10).max(1440).default(30),

  /**
   * 取貨後多少天內還能退款。
   *
   * 前台沒有線上申請表單（退款一律走 LINE 客服），這個天數是**政策數字**：
   * 訂單頁據此決定要不要顯示客服入口，後台開退款單時也用它擋過期的個案
   * （客服可以明確跨過）。
   */
  refundWindowDays: z.number().int().min(1).max(90).default(7),
})

export type PaymentSettings = z.infer<typeof paymentSettingsSchema>

export const DEFAULT_PAYMENT_SETTINGS: PaymentSettings = paymentSettingsSchema.parse({})

/**
 * 讀出付款設定。沒有紀錄或內容壞掉時回預設值 ——
 * 設定讀不到不該讓整個結帳流程掛掉。
 */
export async function getPaymentSettings(): Promise<PaymentSettings> {
  return readSetting(PAYMENT_SETTINGS_KEY, paymentSettingsSchema, DEFAULT_PAYMENT_SETTINGS, '付款')
}

export async function savePaymentSettings(
  input: PaymentSettings,
  updatedById: string,
): Promise<void> {
  await writeSetting(PAYMENT_SETTINGS_KEY, input, updatedById)
}

async function readSetting<T>(
  key: string,
  schema: z.ZodType<T>,
  fallback: T,
  label: string,
): Promise<T> {
  let row: { value: unknown } | null = null
  try {
    row = await db.shopSetting.findUnique({ where: { key }, select: { value: true } })
  } catch (error) {
    console.error(`[settings] 讀取${label}設定失敗，改用預設值`, error)
    return fallback
  }

  if (!row) return fallback

  const parsed = schema.safeParse(row.value)
  if (!parsed.success) {
    console.error(`[settings] ${label}設定格式不符，改用預設值`, parsed.error.issues)
    return fallback
  }
  return parsed.data
}

async function writeSetting(
  key: string,
  value: PaymentSettings | ShippingSettings,
  updatedById: string,
): Promise<void> {
  await db.shopSetting.upsert({
    where: { key },
    create: { key, value, updatedById },
    update: { value, updatedById },
  })
}

/**
 * 前台能選的付款方式。
 * 銀行匯款要帳戶填齊、COD 還要看配送方式與金額上限，兩者都與 prepayEnabled 無關 ——
 * 那個開關管的是綠界那四種。
 */
export function availablePaymentChoices(
  settings: PaymentSettings,
  shippingMethod: 'CVS' | 'HOME',
  grandTotal: number,
): PaymentChoice[] {
  const choices: PaymentChoice[] = []

  if (settings.prepayEnabled) {
    for (const method of ['Credit', 'ATM', 'CVS', 'BARCODE'] as const) {
      if (settings.methods[method]) choices.push(method)
    }
  }

  if (isBankTransferAvailable(settings)) choices.push('BANK')

  if (isCodAvailable(settings, shippingMethod, grandTotal)) choices.push('COD')

  return choices
}

/**
 * 匯款到公司帳戶能不能用。
 *
 * 開關打開但帳戶還沒填完就當作沒開 —— 少了代號或帳號，客人根本轉不了帳，
 * 顯示一個殘缺的選項比不顯示更糟。後台儲存時會擋（見 admin/settings/actions.ts），
 * 這裡是給「舊資料只有開關沒有帳戶」的情況兜底。
 */
export function isBankTransferAvailable(settings: PaymentSettings): boolean {
  return (
    settings.bankTransferEnabled &&
    Boolean(settings.bankName) &&
    Boolean(settings.bankCode) &&
    Boolean(settings.bankAccountNo) &&
    Boolean(settings.bankAccountName)
  )
}

export function isCodAvailable(
  settings: PaymentSettings,
  shippingMethod: 'CVS' | 'HOME',
  grandTotal: number,
): boolean {
  if (!settings.codEnabled) return false
  if (!settings.codShippingMethods.includes(shippingMethod)) return false
  // 超商取貨付款的代收上限是綠界訂的，設定再高也建不了單
  const max = shippingMethod === 'CVS' ? Math.min(settings.codMaxAmount, CVS_COLLECTION_MAX) : settings.codMaxAmount
  return grandTotal > 0 && grandTotal <= max
}

/** 應用層的付款方式：綠界的 ChoosePayment 再加上不經綠界的銀行匯款與貨到付款。 */
export type PaymentChoice = 'Credit' | 'ATM' | 'CVS' | 'BARCODE' | 'BANK' | 'COD'

export const PAYMENT_CHOICES = ['Credit', 'ATM', 'CVS', 'BARCODE', 'BANK', 'COD'] as const

export function isPaymentChoice(value: string): value is PaymentChoice {
  return (PAYMENT_CHOICES as readonly string[]).includes(value)
}

/**
 * 這個付款方式實際上會被綠界／我們保留多久（分鐘）。
 *
 * 庫存預扣一定要用這個值，不能一律用信用卡的保留分鐘數 ——
 * 超商代碼給消費者 2 天，庫存卻只留 30 分鐘的話，訂單會在第 31 分鐘
 * 被排程取消，消費者兩天後拿著有效代碼去繳費，錢收了但沒貨可出。
 */
export function holdMinutesFor(choice: PaymentChoice, settings: PaymentSettings): number {
  switch (choice) {
    case 'ATM':
      return settings.atmExpireDays * 24 * 60
    case 'CVS':
    case 'BARCODE':
      return settings.cvsExpireDays * 24 * 60
    case 'BANK':
      return settings.bankExpireDays * 24 * 60
    case 'COD':
      // 貨到付款不等付款，成立就進備貨，預扣馬上轉實扣
      return 0
    case 'Credit':
      // 信用卡當場刷完，只需要留住「填卡號的那幾分鐘」
      return settings.creditHoldMinutes
  }
}
