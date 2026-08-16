import { normalizeTwMobile } from '@/lib/sms/provider'
import { sanitizeMessageBody } from './cursor'

/**
 * 未登入訪客留下的聯絡方式。
 *
 * 只收 Email 或台灣手機 —— 客服離線時要真的回得到人，
 * 「LINE 上找我」這種自由文字對收件匣沒有用。
 */

export type GuestContactKind = 'EMAIL' | 'PHONE'

export type GuestContact = {
  kind: GuestContactKind
  /** 正規化後的值：Email 轉小寫、手機收斂成 09xxxxxxxx */
  value: string
}

/**
 * 寬鬆的 Email 形狀檢查，不是 RFC 5322。
 *
 * 這一關擋的是打錯字，不是偽造 —— 真正的驗證是客服回信有沒有寄到。
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/**
 * 解析訪客填的聯絡方式；格式不對回 null，由呼叫端決定怎麼報錯。
 *
 * 先判 Email 再判手機：`0912345678@gmail.com` 這種信箱被 normalizeTwMobile
 * 抽掉非數字之後剛好長得像手機號，順序顛倒會把它存成電話。
 */
export function normalizeGuestContact(raw: unknown): GuestContact | null {
  const cleaned = sanitizeMessageBody(raw)?.slice(0, 120)
  if (!cleaned) return null

  const email = cleaned.toLowerCase()
  if (EMAIL_RE.test(email)) return { kind: 'EMAIL', value: email }

  const phone = normalizeTwMobile(cleaned)
  if (phone) return { kind: 'PHONE', value: phone }

  return null
}
