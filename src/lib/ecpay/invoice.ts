import 'server-only'
import { createCipheriv, createDecipheriv } from 'node:crypto'
import { ecpayEndpoints, invoiceConfig } from './config'

/**
 * 綠界電子發票 B2C API v3。
 *
 * 與金流/物流完全不同的一套協定：
 *   - 傳的是 JSON，不是 form
 *   - 沒有 CheckMacValue，改成把整個 Data 欄位用 AES-128-CBC 加密
 *   - 加密前後都要做一次 URL encode（官方文件的步驟 2 與 4）
 */

const ALGORITHM = 'aes-128-cbc'

/**
 * 官方步驟：JSON 字串 → URL encode → AES-128-CBC（PKCS#7）→ Base64
 * HashKey 當金鑰、HashIV 當初始向量，兩者都是 16 bytes。
 */
export function encryptInvoiceData(data: unknown): string {
  const json = JSON.stringify(data)
  const encoded = encodeURIComponent(json)

  const cipher = createCipheriv(
    ALGORITHM,
    Buffer.from(invoiceConfig.hashKey, 'utf8'),
    Buffer.from(invoiceConfig.hashIV, 'utf8'),
  )
  cipher.setAutoPadding(true) // PKCS#7

  return Buffer.concat([cipher.update(encoded, 'utf8'), cipher.final()]).toString('base64')
}

/** 解密流程剛好相反：Base64 → AES 解密 → URL decode → JSON.parse */
export function decryptInvoiceData<T = unknown>(base64: string): T {
  const decipher = createDecipheriv(
    ALGORITHM,
    Buffer.from(invoiceConfig.hashKey, 'utf8'),
    Buffer.from(invoiceConfig.hashIV, 'utf8'),
  )
  decipher.setAutoPadding(true)

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(base64, 'base64')),
    decipher.final(),
  ]).toString('utf8')

  return JSON.parse(decodeURIComponent(decrypted)) as T
}

interface EcpayInvoiceEnvelope {
  MerchantID: string
  RqHeader: { Timestamp: number; Revision: string }
  Data: string
}

interface EcpayInvoiceResponse {
  Platform?: string
  MerchantID: string
  RpHeader?: { Timestamp: number }
  TransCode: number
  TransMsg: string
  Data: string
}

function envelope(data: unknown): EcpayInvoiceEnvelope {
  return {
    MerchantID: invoiceConfig.merchantId,
    RqHeader: {
      Timestamp: Math.floor(Date.now() / 1000),
      Revision: '3.0.0',
    },
    Data: encryptInvoiceData(data),
  }
}

async function callInvoiceApi<T>(endpoint: string, data: unknown): Promise<T> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope(data)),
    signal: AbortSignal.timeout(30_000),
  })

  if (!res.ok) throw new Error(`綠界發票 API HTTP ${res.status}`)

  const body = (await res.json()) as EcpayInvoiceResponse

  // TransCode 是傳輸層的結果，1 才代表電文有被正確接收
  if (body.TransCode !== 1) {
    throw new Error(`綠界發票傳輸失敗（TransCode=${body.TransCode}）：${body.TransMsg}`)
  }

  return decryptInvoiceData<T>(body.Data)
}

// ---------------------------------------------------------------------------
// 開立發票
// ---------------------------------------------------------------------------

export interface IssueInvoiceInput {
  relateNumber: string
  customerName: string
  customerEmail: string
  customerPhone?: string
  /** B2B 才填 */
  taxId?: string
  companyName?: string
  /** 0=不使用載具 1=綠界會員 2=自然人憑證 3=手機條碼 */
  carrierType: '' | '1' | '2' | '3'
  carrierNum?: string
  /** 捐贈 */
  donate: boolean
  loveCode?: string
  items: { name: string; count: number; word: string; price: number }[]
  totalAmount: number
}

export interface IssueInvoiceResult {
  RtnCode: number
  RtnMsg: string
  InvoiceNo?: string
  InvoiceDate?: string
  RandomNumber?: string
}

export function buildIssuePayload(input: IssueInvoiceInput): Record<string, unknown> {
  const isB2B = Boolean(input.taxId)

  return {
    MerchantID: invoiceConfig.merchantId,
    RelateNumber: input.relateNumber,
    CustomerID: '',
    CustomerIdentifier: input.taxId ?? '',
    CustomerName: (isB2B ? (input.companyName ?? '') : input.customerName).slice(0, 60),
    CustomerAddr: '',
    CustomerPhone: input.customerPhone ?? '',
    CustomerEmail: input.customerEmail,
    // 1=捐贈 0=不捐贈
    Print: isB2B ? '1' : '0', // 有統編一定要印紙本
    Donation: input.donate ? '1' : '0',
    LoveCode: input.donate ? (input.loveCode ?? '') : '',
    // 有統編或要捐贈時不能帶載具
    CarrierType: isB2B || input.donate ? '' : input.carrierType,
    CarrierNum: isB2B || input.donate ? '' : (input.carrierNum ?? ''),
    TaxType: '1', // 應稅
    SalesAmount: input.totalAmount,
    InvoiceRemark: '',
    InvType: '07', // 一般稅額
    // 綠界的 Items 是含稅單價
    Items: input.items.map((item, i) => ({
      ItemSeq: i + 1,
      ItemName: item.name.slice(0, 100),
      ItemCount: item.count,
      ItemWord: item.word,
      ItemPrice: item.price,
      ItemTaxType: '1',
      ItemAmount: item.price * item.count,
    })),
    vat: '1', // 單價已含稅
  }
}

export async function issueInvoice(input: IssueInvoiceInput): Promise<IssueInvoiceResult> {
  return callInvoiceApi<IssueInvoiceResult>(
    ecpayEndpoints.invoiceIssue,
    buildIssuePayload(input),
  )
}

// ---------------------------------------------------------------------------
// 作廢與查詢
// ---------------------------------------------------------------------------

export interface VoidInvoiceResult {
  RtnCode: number
  RtnMsg: string
  InvoiceNo?: string
}

export async function voidInvoice(
  invoiceNumber: string,
  reason: string,
): Promise<VoidInvoiceResult> {
  return callInvoiceApi<VoidInvoiceResult>(ecpayEndpoints.invoiceVoid, {
    MerchantID: invoiceConfig.merchantId,
    InvoiceNo: invoiceNumber,
    // 綠界限制 20 字元
    Reason: reason.slice(0, 20),
  })
}

export async function queryInvoice(relateNumber: string): Promise<Record<string, unknown>> {
  return callInvoiceApi<Record<string, unknown>>(ecpayEndpoints.invoiceQuery, {
    MerchantID: invoiceConfig.merchantId,
    RelateNumber: relateNumber,
  })
}
