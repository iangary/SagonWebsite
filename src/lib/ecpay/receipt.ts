import 'server-only'
import { createCipheriv, createDecipheriv } from 'node:crypto'
import { ecpayEndpoints, receiptConfig } from './config'

/**
 * 綠界電子收據。
 *
 * ⚠️ 電子收據不是統一發票，不能報稅抵扣。它只是客戶付款後立刻收到的電子憑證；
 * 紙本發票仍由人工開立、隨包裹寄出。
 *
 * 協定與金流/物流完全不同：
 *   - 傳的是 JSON，不是 form
 *   - 沒有 CheckMacValue，改成把整個 Data 欄位用 AES-128-CBC 加密
 *   - 加密前後都要各做一次 URL encode（官方文件的步驟 2 與 4）
 *
 * 與電子發票 API 的差異：RqHeader 只有 Timestamp，**不帶 Revision**。
 *
 * 規格來源：web_fetch https://developers.ecpay.com.tw/64254.md（收據開立）、
 * 64513.md（作廢）、64544.md（查詢單筆），2026-08-15。
 */

const ALGORITHM = 'aes-128-cbc'

/**
 * 官方步驟：JSON 字串 → URL encode → AES-128-CBC（PKCS#7）→ Base64
 * HashKey 當金鑰、HashIV 當初始向量，兩者都是 16 bytes。
 */
export function encryptReceiptData(data: unknown): string {
  const json = JSON.stringify(data)
  const encoded = encodeURIComponent(json)

  const cipher = createCipheriv(
    ALGORITHM,
    Buffer.from(receiptConfig.hashKey, 'utf8'),
    Buffer.from(receiptConfig.hashIV, 'utf8'),
  )
  cipher.setAutoPadding(true) // PKCS#7

  return Buffer.concat([cipher.update(encoded, 'utf8'), cipher.final()]).toString('base64')
}

/** 解密流程剛好相反：Base64 → AES 解密 → URL decode → JSON.parse */
export function decryptReceiptData<T = unknown>(base64: string): T {
  const decipher = createDecipheriv(
    ALGORITHM,
    Buffer.from(receiptConfig.hashKey, 'utf8'),
    Buffer.from(receiptConfig.hashIV, 'utf8'),
  )
  decipher.setAutoPadding(true)

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(base64, 'base64')),
    decipher.final(),
  ]).toString('utf8')

  return JSON.parse(decodeURIComponent(decrypted)) as T
}

interface EcpayReceiptEnvelope {
  MerchantID: string
  /** 電子收據的 RqHeader 只有 Timestamp，不像電子發票還要帶 Revision */
  RqHeader: { Timestamp: number }
  Data: string
}

interface EcpayReceiptResponse {
  MerchantID: string
  RpHeader?: { Timestamp: number }
  TransCode: number
  TransMsg: string
  Data: string
}

export function buildEnvelope(data: unknown): EcpayReceiptEnvelope {
  return {
    MerchantID: receiptConfig.merchantId,
    // 綠界要求 Unix 秒數，且與綠界主機時間相差不得超過 10 分鐘
    RqHeader: { Timestamp: Math.floor(Date.now() / 1000) },
    Data: encryptReceiptData(data),
  }
}

async function callReceiptApi<T>(endpoint: string, data: unknown): Promise<T> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildEnvelope(data)),
    signal: AbortSignal.timeout(30_000),
  })

  if (!res.ok) throw new Error(`綠界收據 API HTTP ${res.status}`)

  const body = (await res.json()) as EcpayReceiptResponse

  // TransCode 是傳輸層的結果，1 才代表電文有被正確接收；業務結果要再看解密後的 RtnCode
  if (body.TransCode !== 1) {
    throw new Error(`綠界收據傳輸失敗（TransCode=${body.TransCode}）：${body.TransMsg}`)
  }

  return decryptReceiptData<T>(body.Data)
}

// ---------------------------------------------------------------------------
// 開立收據
// ---------------------------------------------------------------------------

/** 索取方式。我們一律走電子（寄到客戶信箱）。 */
const RETRIEVAL_ELECTRONIC = 2
/** 一般收據（押金、定金、雜支這類）。2=公益、4=政治獻金，都用不到。 */
const RECEIPT_TYPE_GENERAL = 1

export interface IssueReceiptInput {
  /** 自訂唯一編號，不可重複。用訂單編號。 */
  relateNumber: string
  /** 收據抬頭 */
  name: string
  email: string
  phone?: string
  cellPhone?: string
  items: { name: string; count: number; price: number }[]
  amount: number
  note?: string
}

export interface IssueReceiptResult {
  RtnCode: number
  RtnMsg: string
  ReceiptNo?: string
}

/** 綠界收據的開立日期格式：yyyy/MM/dd HH:mm:ss（台北時間） */
export function receiptDate(date = new Date()): string {
  const taipei = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }))
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${taipei.getFullYear()}/${pad(taipei.getMonth() + 1)}/${pad(taipei.getDate())} ` +
    `${pad(taipei.getHours())}:${pad(taipei.getMinutes())}:${pad(taipei.getSeconds())}`
  )
}

export function buildIssuePayload(input: IssueReceiptInput): Record<string, unknown> {
  return {
    MerchantID: receiptConfig.merchantId,
    RelateNumber: input.relateNumber,
    ReceiptType: RECEIPT_TYPE_GENERAL,
    RetrievalMethod: RETRIEVAL_ELECTRONIC,
    ReceiptDate: receiptDate(),
    Name: input.name.slice(0, 60),
    // RetrievalMethod=2 時 Email 必填
    Email: input.email,
    Phone: input.phone ?? '',
    CellPhone: input.cellPhone ?? '',
    Note: (input.note ?? '').slice(0, 200),
    Amount: input.amount,
    Items: input.items.map((item, i) => ({
      ItemSeq: i + 1,
      ItemName: item.name.slice(0, 100),
      ItemCount: item.count,
      ItemPrice: item.price,
      ItemAmount: item.price * item.count,
    })),
  }
}

export async function issueReceipt(input: IssueReceiptInput): Promise<IssueReceiptResult> {
  return callReceiptApi<IssueReceiptResult>(
    ecpayEndpoints.receiptIssue,
    buildIssuePayload(input),
  )
}

// ---------------------------------------------------------------------------
// 作廢與查詢
// ---------------------------------------------------------------------------

export interface InvalidReceiptResult {
  RtnCode: number
  RtnMsg: string
  ReceiptNo?: string
}

export async function invalidReceipt(
  receiptNo: string,
  reason: string,
): Promise<InvalidReceiptResult> {
  return callReceiptApi<InvalidReceiptResult>(ecpayEndpoints.receiptInvalid, {
    MerchantID: receiptConfig.merchantId,
    ReceiptNo: receiptNo,
    // 綠界限制 200 字元
    Reason: reason.slice(0, 200),
  })
}

/** ReceiptNo 與 RelateNumber 擇一即可 */
export async function queryReceipt(relateNumber: string): Promise<Record<string, unknown>> {
  return callReceiptApi<Record<string, unknown>>(ecpayEndpoints.receiptQuery, {
    MerchantID: receiptConfig.merchantId,
    RelateNumber: relateNumber,
  })
}
