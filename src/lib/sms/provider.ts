import 'server-only'
import { env } from '@/lib/env'
import { ConsoleSmsProvider } from './console'
import { MitakeSmsProvider } from './mitake'

export interface SmsSendResult {
  /** 供應商端的訊息識別碼，console provider 為 null */
  messageId: string | null
  /** 只有 console provider 會回傳明碼，讓開發/E2E 拿得到驗證碼 */
  devEcho?: string
}

export interface SmsProvider {
  readonly name: string
  send(to: string, text: string): Promise<SmsSendResult>
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
