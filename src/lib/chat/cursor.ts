/**
 * SSE 補查用的游標。
 *
 * 只用 createdAt 會在同一毫秒進來兩則訊息時漏掉後者，所以游標是
 * (createdAt, id) 這組複合鍵，查詢條件寫成
 *   createdAt > t OR (createdAt = t AND id > lastId)
 * 對應 chat_messages 的 @@index([conversationId, createdAt, id])。
 *
 * 這個檔案刻意不碰資料庫與 server-only，方便單獨測試。
 */

export type ChatCursor = {
  createdAt: Date
  id: string
}

/** 訊息內容上限。前端也擋一次，這裡是真正生效的那道。 */
export const MAX_MESSAGE_LENGTH = 2000

/** 序列化成 query string 用的字串：`<ISO 時間>|<id>` */
export function formatCursor(cursor: ChatCursor): string {
  return `${cursor.createdAt.toISOString()}|${cursor.id}`
}

/** 解析游標；格式不對或時間無效都回 null，當成「從頭開始」。 */
export function parseCursor(raw: string | null | undefined): ChatCursor | null {
  if (!raw) return null

  // ISO 時間字串本身不含 |，所以第一個 | 就是分隔符；
  // 用 lastIndexOf 會在 id 內含 | 時把時間切壞，整段游標被當成無效而重播歷史。
  const separator = raw.indexOf('|')
  if (separator <= 0 || separator === raw.length - 1) return null

  const createdAt = new Date(raw.slice(0, separator))
  if (Number.isNaN(createdAt.getTime())) return null

  return { createdAt, id: raw.slice(separator + 1) }
}

const TAB = 0x09
const LINE_FEED = 0x0a
const DELETE = 0x7f

/**
 * 移除控制字元，只留 tab 與換行。
 *
 * 用碼位判斷而不是正則字元類，免得原始控制字元直接被寫進原始碼。
 * 順帶把 CRLF 收斂成 LF —— CR 本身就是控制字元，會在這裡被丟掉。
 */
function stripControlChars(input: string): string {
  let out = ''
  for (const char of input) {
    const code = char.codePointAt(0) ?? 0
    const isControl = code < 0x20 || code === DELETE
    if (!isControl || code === TAB || code === LINE_FEED) out += char
  }
  return out
}

/**
 * 清洗訪客輸入：移除控制字元、去首尾空白、限制長度。
 *
 * 全空白視為沒有內容，回 null 讓呼叫端拒絕。
 */
export function sanitizeMessageBody(raw: unknown): string | null {
  if (typeof raw !== 'string') return null

  const cleaned = stripControlChars(raw).trim()
  if (cleaned.length === 0) return null

  return cleaned.slice(0, MAX_MESSAGE_LENGTH)
}

/** 收件匣列表的摘要文字，單行、最多 80 字。 */
export function previewOf(body: string): string {
  const singleLine = body.replace(/\s+/g, ' ').trim()
  return singleLine.length > 80 ? `${singleLine.slice(0, 79)}…` : singleLine
}
