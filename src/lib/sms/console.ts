import 'server-only'
import type { SmsProvider, SmsSendResult } from './provider'

/**
 * 開發用的假簡訊供應商：不真的送出，把內容印到 log，
 * 並把明碼回傳給呼叫端寫進 PhoneOtp.devCode，讓 E2E 測試可以讀到驗證碼。
 */
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console'

  async send(to: string, text: string): Promise<SmsSendResult> {
    console.info(`\n[SMS:console] → ${to}\n${text}\n`)
    return { messageId: null, devEcho: text }
  }
}
