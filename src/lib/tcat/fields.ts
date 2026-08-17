import type { ShipmentStatus } from '@prisma/client'

/**
 * 黑貓印單 API 的欄位整理。
 *
 * 這裡全部是純函式，沒有 I/O —— 因為這一層是退件風險最高的地方：
 * 姓名帶到全形符號、商品名撞到禁用字、日期落在週日，黑貓都會直接回 E0xx 退件，
 * 而退件時託運單「沒有」成立，等於整筆訂單卡住。所以每條規則都要有測試。
 *
 * 條號對應 印單API平台_API規格書_契客_v2.1.2 的 2.2.1 與附錄一～三。
 */

// ---------------------------------------------------------------------------
// 姓名 / 名稱 / 地址
// ---------------------------------------------------------------------------

/**
 * 附錄二允許的符號：空格 ` ~ ! @ # $ % ^ & * ( ) _ + = - [ ] { } ; : ' " , . ? /
 * 其餘一律濾掉 —— E026 明講「收件人姓名不允許特殊符號及 ASCII 0~31 & 127」。
 * 中文只收常用字（一-鿿），規格寫「不含生僻字」。
 */
const NAME_DISALLOWED = /[^一-鿿A-Za-z0-9 `~!@#$%^&*()_+=[\]{};:'",.?/-]/g

/** 取前 n 個字元（用 code point 切，避免把字拆壞）。 */
function truncate(value: string, max: number): string {
  const chars = [...value]
  return chars.length <= max ? value : chars.slice(0, max).join('')
}

/** 收件人／寄件人姓名，String(30)。 */
export function sanitizeName(name: string): string {
  const cleaned = name.replace(NAME_DISALLOWED, ' ').replace(/\s+/g, ' ').trim()
  return truncate(cleaned, 30)
}

/**
 * 商品名稱不能出現這 18 個字串，否則 E001 退件。
 * 長的排前面，這樣 regex 交替會先吃掉「訴訟文件」「身分證明文件」再輪到「文件」。
 */
const PRODUCT_NAME_BANNED = [
  '身分證明文件',
  '訴訟文件',
  '明信片',
  '報價單',
  '繳費單',
  '通知單',
  '保險單',
  '報名表',
  '申請書',
  '郵簡',
  '信函',
  '發票',
  '公文',
  '帳單',
  '訂單',
  '標單',
  '文件',
  '文書',
  '資料',
] as const

const PRODUCT_NAME_BANNED_RE = new RegExp(PRODUCT_NAME_BANNED.join('|'), 'g')

/**
 * 商品名稱，String(20)。
 * 移除禁用字後可能拼出新的禁用字（例：「訂公文單」→「訂單」），所以要反覆掃到穩定為止。
 */
export function sanitizeProductName(name: string): string {
  let out = name.replace(NAME_DISALLOWED, ' ')

  for (let i = 0; i < 5; i += 1) {
    const next = out.replace(PRODUCT_NAME_BANNED_RE, '')
    if (next === out) break
    out = next
  }

  out = out.replace(/\s+/g, ' ').trim()
  // 全部被濾掉時要有東西可送 —— 這個欄位是必填的
  return truncate(out, 20) || '商品'
}

/** 收件人／寄件人地址，String(120)。 */
export function sanitizeAddress(address: string): string {
  return truncate(address.replace(/\s+/g, ' ').trim(), 120)
}

/**
 * 訂單編號，String(35)，不可含空白，且 E001 明列禁用 / _ @ | \ 。
 * 我們的 orderNo 是 `SG` + base36 大寫，本來就不會踩到，這裡純粹是防禦。
 */
export function sanitizeOrderId(orderNo: string): string {
  return truncate(orderNo.replace(/[/\\@|_\s]/g, ''), 35)
}

// ---------------------------------------------------------------------------
// 電話
// ---------------------------------------------------------------------------

/** 市話 String(30)：非空白時僅允許數字與 - # , 三種符號。 */
export function normalizeTel(tel: string | null | undefined): string {
  if (!tel) return ''
  return truncate(tel.replace(/[^\d\-#,]/g, ''), 30)
}

export interface TcatTelParts {
  /** String(4)，1~4 碼數字 */
  area: string
  /** String(8)，1~8 碼數字 */
  number: string
  /** String(8)，1~8 碼數字 */
  ext: string
}

/**
 * 市話拆成區碼／號碼／分機（規格 2.6.1 第 6~8 項）。
 *
 * 「呼叫黑貓」跟建託運單不一樣 —— 那邊市話是一整欄，這邊硬要拆成三欄，
 * 而且每欄都限定「非空白時只允許 N 碼數字」，塞整串 0227091234 會被退。
 *
 * 區碼一律取前兩碼：037、0826 這類三、四碼區碼會被拆成「03 + 7123456」，
 * 但兩欄接回去仍是同一個號碼，客服中心照樣打得通，不值得為此維護一份區碼表。
 */
export function splitTel(tel: string | null | undefined): TcatTelParts {
  const empty: TcatTelParts = { area: '', number: '', ext: '' }
  if (!tel) return empty

  // 分機可能寫成 #123、ext.123、轉123、分機 123
  const [head = '', tail = ''] = tel.split(/#|ext\.?|轉|分機/i)
  const ext = tail.replace(/\D/g, '').slice(0, 8)

  const digits = head.replace(/\D/g, '')
  if (!digits) return { ...empty, ext }
  // 市話欄位被填成手機時整串丟掉，不然會拆出「09」這個不存在的區碼。
  // 手機有自己的欄位（ContactMobile），那邊會收到它。
  if (/^09\d{8}$/.test(digits)) return { ...empty, ext }

  // 有前導 0 才是區碼；使用者只填了 8 碼本地號碼時整串當號碼
  const hasAreaCode = digits.startsWith('0') && digits.length > 8
  const area = hasAreaCode ? digits.slice(0, 2) : ''
  const number = (hasAreaCode ? digits.slice(2) : digits).slice(0, 8)

  return { area, number, ext }
}

/** 手機 String(10)：非空白時必須是 09 開頭的十碼。不合格就回空字串。 */
export function normalizeMobile(mobile: string | null | undefined): string {
  if (!mobile) return ''
  const digits = mobile.replace(/[^\d+]/g, '').replace(/^\+/, '')
  const local = digits.startsWith('886') ? `0${digits.slice(3)}` : digits
  return /^09\d{8}$/.test(local) ? local : ''
}

// ---------------------------------------------------------------------------
// 黑貓郵碼
// ---------------------------------------------------------------------------

/**
 * ParsingAddress 回傳的黑貓郵碼 → SenderZipCode 要的六碼。
 *
 * 規格 2.2.1 第 20 項：「假設回傳的郵號為 71-802-24-B，則所需的六碼郵號為 80224B（取後六碼）」。
 * 注意這跟中華郵政的郵遞區號完全無關。
 */
export function takeTcatZip(postNumber: string): string | null {
  const compact = postNumber.replace(/[^0-9A-Za-z]/g, '').toUpperCase()
  if (compact.length < 6) return null
  return compact.slice(-6)
}

/** ParsingAddress 回 X 代表該地址不在配送範圍（例：部分離島）。 */
export function isDeliverable(postNumber: string | null | undefined): boolean {
  return Boolean(postNumber) && postNumber !== 'X'
}

// ---------------------------------------------------------------------------
// 日期
// ---------------------------------------------------------------------------

/**
 * 台灣國定假日（yyyyMMdd）。黑貓國定假日與週日不配送，配達日踩到會被 E032 退件。
 *
 * ⚠️ 農曆假日（春節、清明、端午、中秋）每年日期不同，**必須每年手動補**。
 * 這份清單過期只會造成偶發退件（訂單轉人工，不會出錯帳），但仍應每年初更新。
 */
const TW_HOLIDAYS = new Set<string>([
  // 每年固定
  '20260101', // 元旦
  '20260228', // 和平紀念日
  '20261010', // 國慶日
  // TODO(每年更新)：農曆春節、清明、端午、中秋
])

const DAY_MS = 24 * 60 * 60 * 1000
/** 台灣沒有日光節約時間，固定 UTC+8 就夠了。 */
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000

/** 以台北時間格式化成 yyyyMMdd。 */
export function formatTcatDate(date: Date): string {
  return new Date(date.getTime() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10).replace(/-/g, '')
}

function isBusinessDay(date: Date): boolean {
  const taipei = new Date(date.getTime() + TAIPEI_OFFSET_MS)
  // getUTCDay 對加過位移的時間取，等同台北當地的星期
  if (taipei.getUTCDay() === 0) return false // 週日不配送
  return !TW_HOLIDAYS.has(formatTcatDate(date))
}

function nextBusinessDay(date: Date): Date {
  let cursor = new Date(date.getTime() + DAY_MS)
  // 最多往後找 14 天，避免假日表寫壞時無限迴圈
  for (let i = 0; i < 14 && !isBusinessDay(cursor); i += 1) {
    cursor = new Date(cursor.getTime() + DAY_MS)
  }
  return cursor
}

export interface TcatShipmentDates {
  /** yyyyMMdd */
  shipmentDate: string
  /** yyyyMMdd，必為出貨日之後的第一個工作日 */
  deliveryDate: string
}

/**
 * 算出貨日與希望配達日。
 *
 * 規格 2.2.1 第 22、23 項的限制：
 *   - 兩者都是 yyyyMMdd，國定假日與週日不配送
 *   - 配達日必須「大於」出貨日（不可同一天）
 *   - 配達日不得超過出貨日 +7 天
 */
export function shipmentDates(now: Date = new Date()): TcatShipmentDates {
  const shipment = isBusinessDay(now) ? now : nextBusinessDay(now)
  return {
    shipmentDate: formatTcatDate(shipment),
    deliveryDate: formatTcatDate(nextBusinessDay(shipment)),
  }
}

/** 貨態的 CreateDateTime 是 yyyyMMddHHmmss（台北時間）。 */
export function parseTcatDateTime(value: string | null | undefined): Date | null {
  if (!value || !/^\d{14}$/.test(value)) return null
  const [y, mo, d, h, mi, s] = [
    value.slice(0, 4),
    value.slice(4, 6),
    value.slice(6, 8),
    value.slice(8, 10),
    value.slice(10, 12),
    value.slice(12, 14),
  ].map(Number) as [number, number, number, number, number, number]

  const utcMs = Date.UTC(y, mo - 1, d, h, mi, s) - TAIPEI_OFFSET_MS
  const parsed = new Date(utcMs)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

// ---------------------------------------------------------------------------
// 溫層與材積
// ---------------------------------------------------------------------------

export type TcatThermosphere = '0001' | '0002' | '0003'
export type TcatSpec = '0001' | '0002' | '0003' | '0004'

/** 常溫。目前沒有低溫商品，這裡固定，之後有冷藏冷凍再從商品帶。 */
export const THERMOSPHERE_NORMAL: TcatThermosphere = '0001'

const SPEC_ORDER: TcatSpec[] = ['0001', '0002', '0003', '0004']

/**
 * 依訂單件數推材積級距。
 *
 * 商品目前沒有尺寸欄位，所以用「件數」當代理指標：以 defaultSpec 為基準，
 * 每滿 qtyStep 件往上升一級。qtyStep 預設是極大值，等同一律用 defaultSpec。
 *
 * E020：溫層為低溫時包裹尺寸不能是 150cm，所以低溫會被 clamp 在 120cm。
 */
export function specForOrder(
  totalQuantity: number,
  defaultSpec: TcatSpec,
  qtyStep: number,
  thermosphere: TcatThermosphere = THERMOSPHERE_NORMAL,
): TcatSpec {
  const base = SPEC_ORDER.indexOf(defaultSpec)
  const bumps = qtyStep > 0 ? Math.floor(Math.max(0, totalQuantity - 1) / qtyStep) : 0

  const maxIndex = thermosphere === THERMOSPHERE_NORMAL ? SPEC_ORDER.length - 1 : 2
  return SPEC_ORDER[Math.min(base + bumps, maxIndex)]!
}

// ---------------------------------------------------------------------------
// 貨態
// ---------------------------------------------------------------------------

/**
 * 附錄一 貨態代碼表 → 我們的 ShipmentStatus。
 *
 * 表格把貨態分成「配送中／配送完了／退貨／異常」四欄，這裡照著對。
 * 異常（183 地址錯誤、302 BASE 列管…）刻意不對應 —— 那些是「調查處理中」，
 * 包裹還在路上，貿然改狀態會誤導客服。回 null 時呼叫端只寫 log 不動狀態。
 */
const STATUS_MAP: Record<string, ShipmentStatus> = {
  // 配送中
  111: 'IN_TRANSIT', // 轉運中
  151: 'IN_TRANSIT', // 配送中
  152: 'IN_TRANSIT', // 空運中
  153: 'IN_TRANSIT', // 當配下車
  154: 'IN_TRANSIT', // 當配上車
  155: 'IN_TRANSIT', // 轉寄
  159: 'IN_TRANSIT', // 暫置營業所
  168: 'IN_TRANSIT', // 假日暫置
  202: 'IN_TRANSIT', // 轉交配送中
  204: 'IN_TRANSIT', // 委外人員配送中
  205: 'IN_TRANSIT', // 二迴配送
  208: 'IN_TRANSIT', // 轉交超商配達
  209: 'IN_TRANSIT', // 超商取回
  211: 'IN_TRANSIT', // 不在家
  212: 'IN_TRANSIT', // 公司行號休息
  213: 'IN_TRANSIT', // 地址不明
  214: 'IN_TRANSIT', // 搬家
  215: 'IN_TRANSIT', // 拒收
  216: 'IN_TRANSIT', // 另約時間
  308: 'IN_TRANSIT', // 超商通知取回
  420: 'IN_TRANSIT', // 轉交超商配達刪除

  // 配送完了
  301: 'PICKED_UP', // 配完

  // 退貨
  161: 'RETURNED', // 一般退貨
  303: 'RETURNED', // 代收退貨
  305: 'RETURNED', // 退貨配完
  309: 'RETURNED', // B2S 退貨
}

/**
 * 查不到就回 null，呼叫端只留 log。
 *
 * 這不是防禦性寫法而已 —— 規格書 2.11.4 的範例回應裡出現了 StatusId 100「已集貨」，
 * 但附錄一的代碼表並沒有收錄 100。官方文件自己就不一致，所以未知代碼是常態。
 */
export function mapTcatStatus(statusId: string): ShipmentStatus | null {
  return STATUS_MAP[statusId] ?? null
}
