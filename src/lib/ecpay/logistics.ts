import 'server-only'
import type { LogisticsSubType, ShipmentStatus } from '@prisma/client'
import { generateCheckMacValue, verifyCheckMacValue } from './checkmac'
import { callbackUrl, ecpayEndpoints, logisticsConfig, senderConfig } from './config'

/**
 * 綠界物流整合 —— 只做超商取貨 C2C（店到店）。
 *
 * 與金流的差別：簽章用 MD5，不是 SHA256。
 *
 * 宅配不走綠界（黑貓是另外簽約的），分流見 src/lib/orders/logistics.ts。
 * 綠界的超商申請類型分 B2C 與 C2C，官方規定兩者不能混串、也不共用商店代號；
 * 我們申請的是 C2C，所以這裡只處理 *C2C 這四個 LogisticsSubType。
 */

/** 綠界 C2C 支援的四家超商 */
export const CVS_SUBTYPES = [
  { value: 'UNIMARTC2C', label: '7-ELEVEN' },
  { value: 'FAMIC2C', label: '全家' },
  { value: 'HILIFEC2C', label: '萊爾富' },
  { value: 'OKMARTC2C', label: 'OK 超商' },
] as const

export type CvsSubType = (typeof CVS_SUBTYPES)[number]['value']

const C2C_SUBTYPES = new Set<LogisticsSubType>(CVS_SUBTYPES.map((s) => s.value))

/** 同時當型別守衛用，讓呼叫端收窄成 CvsSubType 後才能進綠界建單 */
export function isC2C(subType: LogisticsSubType): subType is CvsSubType {
  return C2C_SUBTYPES.has(subType)
}

/**
 * 宅配可選的物流商。黑貓是我們自己簽約的，不經綠界 ——
 * 這份清單只產生前台選項與後台顯示，綠界建單不會收到這些值。
 */
export const HOME_SUBTYPES = [{ value: 'TCAT', label: '黑貓宅急便' }] as const

/** 綠界對商品金額的限制。超出範圍建單會被退回錯誤碼 10500040。 */
export const GOODS_AMOUNT_MIN = 1
export const GOODS_AMOUNT_MAX = 20_000

export const LOGISTICS_SUBTYPE_LABEL: Record<LogisticsSubType, string> = {
  UNIMARTC2C: '7-ELEVEN 取貨',
  FAMIC2C: '全家取貨',
  HILIFEC2C: '萊爾富取貨',
  OKMARTC2C: 'OK 超商取貨',
  UNIMART: '7-ELEVEN 取貨',
  FAMI: '全家取貨',
  HILIFE: '萊爾富取貨',
  TCAT: '黑貓宅急便',
  POST: '中華郵政',
}

/**
 * ShipmentStatus → 前台 i18n 的 key。
 *
 * ARRIVED 在兩種通路的意思完全不同：超商是「到店了，7 天內要來拿」（需要客戶動作），
 * 宅配是「配送中」（不需要動作）。共用一個字會讓超商客戶錯過取貨期限。
 */
export function shipmentStatusKey(status: ShipmentStatus, subType: LogisticsSubType): string {
  if (status === 'ARRIVED') return isC2C(subType) ? 'ARRIVED_CVS' : 'ARRIVED_HOME'
  return status
}

/**
 * 各通路的貨態查詢頁。這些頁面多半不吃 query string 帶單號，
 * 所以前台是「顯示單號 + 外連查詢頁」，讓客戶自己貼上去。
 *
 * 全家、萊爾富、OK 刻意沒有列入 —— 查詢頁網址沒能實際確認過，
 * 寧可少一個連結也不要把客戶送到 404。之後確認了再補進來即可，
 * 前台已經處理沒有網址的情況（只顯示單號）。
 */
export const TRACKING_URL: Partial<Record<LogisticsSubType, string>> = {
  UNIMARTC2C: 'https://eservice.7-11.com.tw/e-tracking/search.aspx',
  UNIMART: 'https://eservice.7-11.com.tw/e-tracking/search.aspx',
  TCAT: 'https://www.t-cat.com.tw/inquire/trace.aspx',
  POST: 'https://postserv.post.gov.tw/pstmail/main_mail.html',
}

// ---------------------------------------------------------------------------
// 電子地圖（選擇門市）
// ---------------------------------------------------------------------------

/**
 * 產生導向綠界電子地圖的表單參數。
 *
 * 注意：電子地圖這一支「不需要」CheckMacValue，綠界文件明確說明。
 * ExtraData 會原封不動回拋，用來把選店結果對回是哪一次結帳。
 */
export function buildExpressMapParams(subType: CvsSubType, extraData: string) {
  return {
    action: ecpayEndpoints.logisticsMap,
    params: {
      MerchantID: logisticsConfig.merchantId,
      LogisticsType: 'CVS',
      LogisticsSubType: subType,
      IsCollection: 'N',
      ServerReplyURL: callbackUrl('/api/ecpay/logistics/map-reply'),
      ExtraData: extraData,
      Device: '0',
    } as Record<string, string>,
  }
}

export interface CvsStoreSelection {
  subType: LogisticsSubType
  storeId: string
  storeName: string
  address: string
  telephone: string
  extraData: string
}

export function parseMapReply(params: Record<string, string>): CvsStoreSelection | null {
  if (!params.CVSStoreID) return null
  return {
    subType: (params.LogisticsSubType as LogisticsSubType) ?? 'UNIMARTC2C',
    storeId: params.CVSStoreID,
    storeName: params.CVSStoreName ?? '',
    address: params.CVSAddress ?? '',
    telephone: params.CVSTelephone ?? '',
    extraData: params.ExtraData ?? '',
  }
}

// ---------------------------------------------------------------------------
// 建立物流訂單
// ---------------------------------------------------------------------------

export interface CreateShipmentInput {
  merchantTradeNo: string
  subType: CvsSubType
  goodsAmount: number
  goodsName: string
  receiverName: string
  receiverCellphone: string
  receiverEmail?: string
  /** 電子地圖回傳的門市代號 */
  receiverStoreId: string
}

/** 綠界物流的日期格式與金流不同：yyyy/MM/dd HH:mm:ss（同樣是台北時間） */
function logisticsTradeDate(date = new Date()): string {
  const taipei = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }))
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${taipei.getFullYear()}/${pad(taipei.getMonth() + 1)}/${pad(taipei.getDate())} ` +
    `${pad(taipei.getHours())}:${pad(taipei.getMinutes())}:${pad(taipei.getSeconds())}`
  )
}

/** GoodsName 的上限。綠界算的是顯示寬度，不是字元數。 */
const GOODS_NAME_MAX_WIDTH = 50

/**
 * 綠界的長度限制以顯示寬度計算：中文與全形字佔 2，其餘佔 1。
 * 直接用 String.slice 會讓中文品名超過上限而被退件。
 */
function truncateToWidth(text: string, maxWidth: number): string {
  let width = 0
  let out = ''
  for (const char of text) {
    const charWidth = (char.codePointAt(0) ?? 0) > 0x7f ? 2 : 1
    if (width + charWidth > maxWidth) break
    width += charWidth
    out += char
  }
  return out
}

/**
 * 綠界對 GoodsName 的限制：不可包含 ^ ' ` ! @ # % & * + \ " < > | _ [ ]
 * 且顯示寬度上限 50。踩到會直接被退件。
 */
export function sanitizeGoodsName(name: string, maxWidth = GOODS_NAME_MAX_WIDTH): string {
  const cleaned = name.replace(/[\^'`!@#%&*+\\"<>|_[\]]/g, ' ').replace(/\s+/g, ' ').trim()
  return truncateToWidth(cleaned, maxWidth) || '商品'
}

export function buildCreateShipmentParams(input: CreateShipmentInput): Record<string, string> {
  // 超商一律是 CVS，B2C 也一樣 —— LogisticsType 不隨 SubType 變動
  const params: Record<string, string> = {
    MerchantID: logisticsConfig.merchantId,
    MerchantTradeNo: input.merchantTradeNo,
    MerchantTradeDate: logisticsTradeDate(),
    LogisticsType: 'CVS',
    LogisticsSubType: input.subType,
    GoodsAmount: String(input.goodsAmount),
    GoodsName: sanitizeGoodsName(input.goodsName),
    // 寄件人姓名限 4~10 字元，且不可填公司名 —— 否則退件時領不回來
    SenderName: senderConfig.name,
    SenderCellPhone: senderConfig.cellphone,
    ReceiverName: input.receiverName,
    ReceiverCellPhone: input.receiverCellphone,
    ReceiverStoreID: input.receiverStoreId,
    ServerReplyURL: callbackUrl('/api/ecpay/logistics/reply'),
    IsCollection: 'N',
  }

  if (input.receiverEmail) params.ReceiverEmail = input.receiverEmail

  params.CheckMacValue = generateCheckMacValue(params, logisticsConfig.credentials, 'md5')
  return params
}

export interface CreateShipmentResult {
  ok: boolean
  allPayLogisticsId?: string
  /** C2C 的一段標 / B2C 的托運單號 */
  shipmentNo?: string
  cvsValidationNo?: string
  raw: Record<string, string>
  error?: string
}

/**
 * 呼叫綠界建立物流訂單。
 *
 * 成功時回應是 `1|參數=值&參數=值...`，失敗時是 `0|錯誤訊息`。
 */
export async function createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
  const params = buildCreateShipmentParams(input)

  const res = await fetch(ecpayEndpoints.logisticsCreate, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(30_000),
  })

  if (!res.ok) {
    return { ok: false, raw: {}, error: `綠界物流 HTTP ${res.status}` }
  }

  const body = await res.text()
  const separator = body.indexOf('|')
  const status = separator === -1 ? body : body.slice(0, separator)
  const rest = separator === -1 ? '' : body.slice(separator + 1)

  if (status !== '1') {
    return { ok: false, raw: { body }, error: rest || body }
  }

  const parsed = Object.fromEntries(new URLSearchParams(rest))

  return {
    ok: true,
    allPayLogisticsId: parsed.AllPayLogisticsID,
    // C2C 回 CVSPaymentNo（一段標），B2C 回 BookingNote（托運單號）
    shipmentNo: parsed.CVSPaymentNo ?? parsed.BookingNote,
    cvsValidationNo: parsed.CVSValidationNo,
    raw: parsed,
  }
}

// ---------------------------------------------------------------------------
// 物流狀態回拋
// ---------------------------------------------------------------------------

export function verifyLogisticsCallback(params: Record<string, string>): boolean {
  return verifyCheckMacValue(params, logisticsConfig.credentials, 'md5')
}

export type MappedShipmentStatus =
  | 'CREATED'
  | 'IN_TRANSIT'
  | 'ARRIVED'
  | 'PICKED_UP'
  | 'RETURNED'
  | 'FAILED'

/**
 * 綠界物流狀態碼 → 我們的 ShipmentStatus。
 *
 * 綠界每個通路（7-ELEVEN 2xxx、全家 3xxx、萊爾富 2xxx、宅配 3xx）都有自己的碼表，
 * 這裡只收錄「對消費者有意義」的里程碑。各集合必須互斥 ——
 * 同一個碼落在兩個集合會依判斷順序而定，很容易把「剛建單」誤判成「已出貨」。
 *
 * 認不得的碼一律回 null，呼叫端只更新 statusCode/statusMsg 而不動 status，
 * 這比亂猜安全。要擴充請對照綠界文件的「物流狀態表」附錄。
 */
const STATUS_CODES: Record<MappedShipmentStatus, ReadonlySet<string>> = {
  // 綠界已收到訂單資料 / 訂單建立完成 —— 尚未出貨
  CREATED: new Set(['300', '310', '2001', '3001']),
  // 已出貨、運送途中
  IN_TRANSIT: new Set(['2030', '2024', '3006', '3024']),
  // 已到店可取貨 / 宅配配送中
  ARRIVED: new Set(['2063', '2073', '3018', '2068']),
  // 消費者已完成取貨
  PICKED_UP: new Set(['2067', '2070', '3022', '3023']),
  // 退貨、退回門市、逾期未取
  RETURNED: new Set(['2065', '2074', '3019', '2069', '3020']),
  // 建單或配送失敗
  FAILED: new Set(['2072', '3021']),
}

export function mapLogisticsStatus(code: string): MappedShipmentStatus | null {
  for (const [status, codes] of Object.entries(STATUS_CODES)) {
    if (codes.has(code)) return status as MappedShipmentStatus
  }
  // 2xx/3xx 的退貨系列碼很多，用前綴收尾
  if (/^(204|304)\d$/.test(code)) return 'RETURNED'
  return null
}

/** 查詢物流訂單目前狀態，用於後台人工對帳 */
export async function queryLogisticsTradeInfo(
  merchantTradeNo: string,
): Promise<Record<string, string>> {
  const params: Record<string, string> = {
    MerchantID: logisticsConfig.merchantId,
    MerchantTradeNo: merchantTradeNo,
    TimeStamp: String(Math.floor(Date.now() / 1000)),
  }
  params.CheckMacValue = generateCheckMacValue(params, logisticsConfig.credentials, 'md5')

  const res = await fetch(ecpayEndpoints.logisticsQuery, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) throw new Error(`綠界物流查詢失敗：HTTP ${res.status}`)
  return Object.fromEntries(new URLSearchParams(await res.text()))
}

/** 列印一段標的表單參數。回傳讓前端 POST 開新視窗。 */
export function buildPrintDocumentParams(
  subType: CvsSubType,
  allPayLogisticsId: string,
  cvsPaymentNo?: string,
  cvsValidationNo?: string,
): { action: string; params: Record<string, string> } {
  const action = {
    UNIMARTC2C: ecpayEndpoints.logisticsPrintUnimartC2C,
    FAMIC2C: ecpayEndpoints.logisticsPrintFamiC2C,
    HILIFEC2C: ecpayEndpoints.logisticsPrintHilifeC2C,
    OKMARTC2C: ecpayEndpoints.logisticsPrintOkmartC2C,
  }[subType]

  const params: Record<string, string> = {
    MerchantID: logisticsConfig.merchantId,
    AllPayLogisticsID: allPayLogisticsId,
  }

  if (cvsPaymentNo) params.CVSPaymentNo = cvsPaymentNo
  // 7-11 的一段標需要驗證碼，其他通路不用
  if (subType === 'UNIMARTC2C' && cvsValidationNo) params.CVSValidationNo = cvsValidationNo

  params.CheckMacValue = generateCheckMacValue(params, logisticsConfig.credentials, 'md5')
  return { action, params }
}
