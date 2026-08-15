import 'server-only'
import { TCAT_LIMITS, TCAT_TIMEOUT_MS, tcatConfig, tcatEndpoint, type TcatService } from './config'

/**
 * 統一速達印單 API 的 HTTP 層。
 *
 * 跟綠界的差別（照抄綠界的寫法會全錯）：
 *   1. 沒有簽章 —— 憑證是 body 裡的 CustomerId / CustomerToken
 *   2. JSON 進 JSON 出，不是 form-urlencoded
 *   3. 逾時要 120 秒，規格書明講「當服務繁忙時，連線逾時時間請設定最少 120 秒」
 *   4. 一律批次語意（Orders / Addresses 是陣列），單筆也要包成陣列
 */

/** 每支 API 的共同外層。IsOK='N' 時 Data 為 null，錯誤原因在 Message。 */
export interface TcatEnvelope<T> {
  SrvTranId: string
  IsOK: 'Y' | 'N'
  Message: string
  Data: T | null
}

export class TcatApiError extends Error {
  constructor(
    readonly service: TcatService,
    message: string,
    readonly srvTranId?: string,
  ) {
    super(`黑貓 ${service}：${message}`)
    this.name = 'TcatApiError'
  }
}

async function callTcat<T>(service: TcatService, body: object): Promise<TcatEnvelope<T>> {
  const res = await fetch(tcatEndpoint(service), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      CustomerId: tcatConfig.customerId,
      CustomerToken: tcatConfig.customerToken,
      ...body,
    }),
    signal: AbortSignal.timeout(TCAT_TIMEOUT_MS),
  })

  if (!res.ok) {
    // 4xx 也會帶 JSON 的錯誤說明，讀得到就用它，讀不到才回 HTTP 狀態碼
    const detail = await res.text().catch(() => '')
    throw new TcatApiError(service, detail || `HTTP ${res.status}`)
  }

  return (await res.json()) as TcatEnvelope<T>
}

// ---------------------------------------------------------------------------
// 2.1 查詢郵號 ParsingAddress
// ---------------------------------------------------------------------------

interface ParsingAddressData {
  Addresses: { Search: string; PostNumber: string }[]
}

/**
 * 地址 → 黑貓郵碼。建單前一定要先過這一關：
 * 回不出郵碼（或回 'X'）代表該地址黑貓收不到也送不到，直接建單只會被 E053/E055 退件。
 *
 * 注意多筆與單筆的失敗語意不同（規格 2.1.2 第 9 項）：
 * 單筆查不到會回 IsOK='N'；多筆查不到只會讓該筆的 PostNumber 是空字串，IsOK 仍為 'Y'。
 */
export async function parsingAddress(addresses: string[]): Promise<Map<string, string>> {
  if (addresses.length === 0) return new Map()
  if (addresses.length > TCAT_LIMITS.parsingAddress) {
    throw new TcatApiError('ParsingAddress', `一次最多查 ${TCAT_LIMITS.parsingAddress} 筆地址`)
  }

  const res = await callTcat<ParsingAddressData>('ParsingAddress', {
    PostType: '01',
    Addresses: addresses.map((Search) => ({ Search })),
  })

  if (res.IsOK !== 'Y' || !res.Data) {
    throw new TcatApiError('ParsingAddress', res.Message, res.SrvTranId)
  }

  return new Map(res.Data.Addresses.map((a) => [a.Search, a.PostNumber]))
}

// ---------------------------------------------------------------------------
// 2.2 列印託運單（宅配）PrintOBT
// ---------------------------------------------------------------------------

/** 規格 2.2.1 的 Orders[] 單筆。欄位名照抄規格書，不要改成 camelCase。 */
export interface TcatOrder {
  OBTNumber: string
  OrderId: string
  Thermosphere: string
  Spec: string
  ReceiptLocation: string
  ReceiptStationNo: string
  RecipientName: string
  RecipientTel: string
  RecipientMobile: string
  RecipientAddress: string
  SenderName: string
  SenderTel: string
  SenderMobile: string
  SenderZipCode: string
  SenderAddress: string
  ShipmentDate: string
  DeliveryDate: string
  DeliveryTime: string
  IsFreight: 'Y' | 'N'
  IsCollection: 'Y' | 'N'
  CollectionAmount: number
  IsSwipe: 'Y' | 'N'
  IsMobilePay: 'Y' | 'N'
  IsDeclare: 'Y' | 'N'
  DeclareAmount: number
  ProductTypeId: string
  ProductName: string
  Memo: string
}

interface PrintObtData {
  PrintDateTime: string
  Orders: { OBTNumber: string; OrderId: string }[]
  FileNo: string
}

export interface PrintObtResult {
  /** OrderId → 託運單號 */
  obtNumbers: Map<string, string>
  /** ⚠️ 只有 24 小時有效，拿到後要立刻 downloadObt */
  fileNo: string
  printDateTime: string
  raw: unknown
}

/**
 * 建立宅配託運單。
 *
 * ⚠️ 這支 API **有副作用且不可逆**：回應成功就代表託運單已經成立、單號已配發。
 * 呼叫端絕對不能因為後續步驟失敗就重跑，否則會建出第二張真實託運單。
 */
export async function printObt(orders: TcatOrder[]): Promise<PrintObtResult> {
  if (orders.length === 0) throw new TcatApiError('PrintOBT', '沒有要建立的託運單')
  if (orders.length > TCAT_LIMITS.printObt) {
    throw new TcatApiError('PrintOBT', `一次最多建 ${TCAT_LIMITS.printObt} 筆`)
  }

  const res = await callTcat<PrintObtData>('PrintOBT', {
    PrintType: '01', // 使用速達標準版型，由系統分配託運單號
    PrintOBTType: tcatConfig.obtType,
    Orders: orders,
  })

  if (res.IsOK !== 'Y' || !res.Data) {
    throw new TcatApiError('PrintOBT', res.Message, res.SrvTranId)
  }

  return {
    obtNumbers: new Map(res.Data.Orders.map((o) => [o.OrderId, o.OBTNumber])),
    fileNo: res.Data.FileNo,
    printDateTime: res.Data.PrintDateTime,
    raw: res,
  }
}

// ---------------------------------------------------------------------------
// 2.5 下載託運單 DownloadOBT
// ---------------------------------------------------------------------------

/**
 * 用 FileNo 取回託運單 PDF。
 *
 * ⚠️ FileNo 自 PrintOBT 成功起算 **只有 24 小時**，逾期檔案編號失效且無法再下載 ——
 * 屆時只能重新提交一筆新的託運單資料（會拿到新的託運單號，舊單已成立收不回來）。
 * 所以建單成功後要立刻下載存檔，不要等到使用者按列印才抓。
 *
 * 回應格式與眾不同：成功是 HTTP 200 + binary，失敗是 HTTP 400 + JSON。
 */
export async function downloadObt(fileNo: string, obtNumbers?: string[]): Promise<Buffer> {
  const res = await fetch(tcatEndpoint('DownloadOBT'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      CustomerId: tcatConfig.customerId,
      CustomerToken: tcatConfig.customerToken,
      FileNo: fileNo,
      // 只補印其中幾張時才帶；不帶就是整個檔案編號裡的全部託運單
      ...(obtNumbers?.length ? { Orders: obtNumbers.map((OBTNumber) => ({ OBTNumber })) } : {}),
    }),
    signal: AbortSignal.timeout(TCAT_TIMEOUT_MS),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    let message = body || `HTTP ${res.status}`
    try {
      const parsed = JSON.parse(body) as TcatEnvelope<never>
      if (parsed.Message) message = parsed.Message
    } catch {
      // 不是 JSON 就用原始內容
    }
    throw new TcatApiError('DownloadOBT', message)
  }

  return Buffer.from(await res.arrayBuffer())
}

// ---------------------------------------------------------------------------
// 2.11 查詢託運單貨態 OBTStatus
// ---------------------------------------------------------------------------

export interface TcatStatusEntry {
  StatusId: string
  StatusName: string
  CreateDateTime: string
  StationName: string
}

export interface TcatObtStatus {
  OBTNumber: string
  OrderId: string
  StationName: string
  CreateDateTime: string
  CustomerId: string
  StatusId: string
  StatusName: string
  /** 由新到舊 */
  StatusList: TcatStatusEntry[]
}

/**
 * 查貨態。沒有 webhook，只能主動問。
 *
 * 規格 2.11.1 的限制（超過會被拒絕）：
 *   - 每契客每日最多 3,000 次
 *   - 同時最多 3 個查詢在跑
 *   - **同一託運單號每 2 小時只能查一次**
 *
 * 完全沒有貨態時 API 回 IsOK='N'（Message 是「無貨態明細資訊」），這是正常情況
 * 不是錯誤 —— 剛建單還沒集貨就會這樣，所以回空陣列而不是 throw。
 */
export async function queryObtStatus(obtNumbers: string[]): Promise<TcatObtStatus[]> {
  if (obtNumbers.length === 0) return []
  if (obtNumbers.length > TCAT_LIMITS.obtStatus) {
    throw new TcatApiError('OBTStatus', `一次最多查 ${TCAT_LIMITS.obtStatus} 筆託運單`)
  }

  const res = await callTcat<{ OBTs: TcatObtStatus[] }>('OBTStatus', {
    OBTNumbers: obtNumbers,
  })

  if (res.IsOK !== 'Y' || !res.Data) return []

  return res.Data.OBTs ?? []
}
