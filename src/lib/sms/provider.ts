import 'server-only'
import { env } from '@/lib/env'
import { ConsoleSmsProvider } from './console'
import { MitakeSmsProvider } from './mitake'

export interface SmsSendResult {
  /** 供應商端的訊息識別碼，console provider 為 null */
  messageId: string | null
  /** 只有 console provider 會回傳明碼，讓開發/E2E 拿得到驗證碼 */
  devEcho?: string
  /** 供應商回報的剩餘點數。三竹每次發送都會回，console provider 沒有 */
  accountPoint?: number | null
  /** 供應商判定為重複發送（未實際送出，只是回上次的結果） */
  duplicate?: boolean
}

export interface SmsProvider {
  readonly name: string
  /**
   * @param clientId 冪等鍵。同一則簡訊的重試要沿用同一個值，供應商端才會去重；
   *   使用者主動「重新發送」必須換新的，否則他收不到第二則。不支援的 provider 會忽略。
   */
  send(to: string, text: string, clientId?: string): Promise<SmsSendResult>
}

let cached: SmsProvider | undefined

export function getSmsProvider(): SmsProvider {
  if (cached) return cached
  cached = env.SMS_PROVIDER === 'mitake' ? new MitakeSmsProvider() : new ConsoleSmsProvider()
  return cached
}

/**
 * 台灣手機號碼正規化：09xxxxxxxx。
 * 接受 +8869xxxxxxxx / 8869xxxxxxxx / 09xx-xxx-xxx 等常見寫法。
 * 不合法回傳 null，由呼叫端決定要怎麼報錯。
 */
export function normalizeTwMobile(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '').replace(/^\+/, '')
  let local = digits
  if (local.startsWith('886')) local = '0' + local.slice(3)
  if (!/^09\d{8}$/.test(local)) return null
  return local
}

/** 顯示用遮罩：0912345678 → 0912***678 */
export function maskMobile(phone: string): string {
  if (phone.length < 10) return phone
  return `${phone.slice(0, 4)}***${phone.slice(-3)}`
}
