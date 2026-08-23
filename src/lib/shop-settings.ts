import 'server-only'
import { z } from 'zod'
import { db } from '@/lib/db'
import { env } from '@/lib/env'

/**
 * 後台可改的付款設定。
 *
 * 與 shop-config.ts 的分工：那裡是「部署層」的設定（金鑰、網域、運費），
 * 改了要重新部署；這裡是「營運層」的設定（要不要開放貨到付款、繳費期限幾天），
 * 店長在後台就能改，存在 shop_settings 這張表。
 *
 * 值用 zod 解析並補預設值 —— 加欄位不必跑 migration，舊資料少一欄也不會壞。
 */

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
   * 超商代碼／條碼的繳費期限（天）。綠界上限 30 天。
   * 期限拉長代表庫存也要跟著保留同樣長的時間（否則會出現「繳了費卻沒貨」）。
   */
  cvsExpireDays: z.number().int().min(1).max(30).default(2),
  /** ATM 虛擬帳號的付款期限（天）。綠界的單位就是天，下限 1 天。 */
  atmExpireDays: z.number().int().min(1).max(30).default(2),

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
  let row: { value: unknown } | null = null
  try {
    row = await db.shopSetting.findUnique({
      where: { key: PAYMENT_SETTINGS_KEY },
      select: { value: true },
    })
  } catch (error) {
    console.error('[settings] 讀取付款設定失敗，改用預設值', error)
    return DEFAULT_PAYMENT_SETTINGS
  }

  if (!row) return DEFAULT_PAYMENT_SETTINGS

  const parsed = paymentSettingsSchema.safeParse(row.value)
  if (!parsed.success) {
    console.error('[settings] 付款設定格式不符，改用預設值', parsed.error.issues)
    return DEFAULT_PAYMENT_SETTINGS
  }
  return parsed.data
}

export async function savePaymentSettings(
  input: PaymentSettings,
  updatedById: string,
): Promise<void> {
  await db.shopSetting.upsert({
    where: { key: PAYMENT_SETTINGS_KEY },
    create: { key: PAYMENT_SETTINGS_KEY, value: input, updatedById },
    update: { value: input, updatedById },
  })
}

/** 前台能選的付款方式（COD 只有在設定允許、且這個配送方式支援時才出現）。 */
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

  if (isCodAvailable(settings, shippingMethod, grandTotal)) choices.push('COD')

  return choices
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

/** 應用層的付款方式：綠界的 ChoosePayment 再加上不經綠界的貨到付款。 */
export type PaymentChoice = 'Credit' | 'ATM' | 'CVS' | 'BARCODE' | 'COD'

export const PAYMENT_CHOICES = ['Credit', 'ATM', 'CVS', 'BARCODE', 'COD'] as const

export function isPaymentChoice(value: string): value is PaymentChoice {
  return (PAYMENT_CHOICES as readonly string[]).includes(value)
}

/**
 * 這個付款方式實際上會被綠界／我們保留多久（分鐘）。
 *
 * 庫存預扣一定要用這個值，不能用 STOCK_RESERVATION_MINUTES ——
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
    case 'COD':
      // 貨到付款不等付款，成立就進備貨，預扣馬上轉實扣
      return 0
    case 'Credit':
      // 信用卡當場刷完，只需要留住「填卡號的那幾分鐘」
      return env.STOCK_RESERVATION_MINUTES
  }
}
