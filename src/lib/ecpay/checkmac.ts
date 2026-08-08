import { createHash } from 'node:crypto'

/**
 * 綠界 CheckMacValue 計算。
 *
 * 金流、物流、發票查詢都用同一套演算法，差別只在雜湊函數（SHA256 / MD5），
 * 所以簽章邏輯集中在這裡，各服務只要傳入自己的 HashKey / HashIV / 演算法。
 *
 * 步驟（依官方文件）：
 *   1. 參數依 key 英文字母 A→Z 排序（不分大小寫）
 *   2. 串成 HashKey={key}&k1=v1&...&HashIV={iv}
 *   3. 整串做 URL encode（.NET HttpUtility.UrlEncode 風格）
 *   4. 轉小寫
 *   5. SHA256 或 MD5
 *   6. 轉大寫
 */

export type HashAlgorithm = 'sha256' | 'md5'

export interface EcpayCredentials {
  hashKey: string
  hashIV: string
}

/**
 * 模擬 .NET 的 HttpUtility.UrlEncode。
 *
 * 與 JS 的 encodeURIComponent 有三處不同，不處理的話簽章會對不起來：
 *   - 空白：.NET 編成 '+'，encodeURIComponent 編成 '%20'
 *   - 單引號：.NET 編成 '%27'，encodeURIComponent 保持原樣
 *   - 波浪號：.NET 編成 '%7e'，encodeURIComponent 保持原樣
 * 其餘 -_.!*() 兩者都保持原樣，行為一致。
 */
export function dotNetUrlEncode(input: string): string {
  return encodeURIComponent(input)
    .replace(/%20/g, '+')
    .replace(/'/g, '%27')
    .replace(/~/g, '%7e')
}

/** 依 key 做不分大小寫的 A→Z 排序 */
function sortByKey(params: Record<string, string | number>): [string, string][] {
  return Object.entries(params)
    .filter(([key]) => key !== 'CheckMacValue')
    .map(([key, value]) => [key, String(value ?? '')] as [string, string])
    .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase(), 'en'))
}

/** 產生第 2 步的原始字串，獨立出來方便除錯與測試。 */
export function buildRawString(
  params: Record<string, string | number>,
  { hashKey, hashIV }: EcpayCredentials,
): string {
  const body = sortByKey(params)
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
  return `HashKey=${hashKey}&${body}&HashIV=${hashIV}`
}

export function generateCheckMacValue(
  params: Record<string, string | number>,
  credentials: EcpayCredentials,
  algorithm: HashAlgorithm = 'sha256',
): string {
  const raw = buildRawString(params, credentials)
  const encoded = dotNetUrlEncode(raw).toLowerCase()
  return createHash(algorithm).update(encoded, 'utf8').digest('hex').toUpperCase()
}

/**
 * 驗證綠界回拋的簽章。
 *
 * 用固定時間比較，避免用 !== 比字串時洩漏前綴資訊。
 */
export function verifyCheckMacValue(
  params: Record<string, string | number>,
  credentials: EcpayCredentials,
  algorithm: HashAlgorithm = 'sha256',
): boolean {
  const received = String(params.CheckMacValue ?? '')
  if (!received) return false

  const expected = generateCheckMacValue(params, credentials, algorithm)
  if (received.length !== expected.length) return false

  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ received.charCodeAt(i)
  }
  return diff === 0
}

/**
 * 綠界回拋是 application/x-www-form-urlencoded，
 * 轉成純字串 map 才能丟進簽章驗證。
 */
export function formDataToParams(form: FormData): Record<string, string> {
  const params: Record<string, string> = {}
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') params[key] = value
  }
  return params
}
