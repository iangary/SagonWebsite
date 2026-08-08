import 'server-only'
import { env } from '@/lib/env'
import type { SmsProvider, SmsSendResult } from './provider'

const MITAKE_ENDPOINT = 'https://smsapi.mitake.com.tw/api/mtk/SmSend'

/**
 * 三竹簡訊（Mitake）。
 *
 * 回應是 INI 風格的純文字，例如：
 *   [1]
 *   msgid=1234567890
 *   statuscode=1
 *   AccountPoint=999
 *
 * statuscode 為 0/1/2/4 視為已受理，其餘皆為失敗。
 * 文件：https://sms.mitake.com.tw/ → API 說明
 */
export class MitakeSmsProvider implements SmsProvider {
  readonly name = 'mitake'

  async send(to: string, text: string): Promise<SmsSendResult> {
    if (!env.MITAKE_USERNAME || !env.MITAKE_PASSWORD) {
      throw new Error('SMS_PROVIDER=mitake 但未設定 MITAKE_USERNAME / MITAKE_PASSWORD')
    }

    const params = new URLSearchParams({
      username: env.MITAKE_USERNAME,
      password: env.MITAKE_PASSWORD,
      dstaddr: to,
      smbody: text,
      // 三竹以 Big5 為預設，明確指定 UTF-8 才不會變亂碼
      CharsetURL: 'UTF-8',
      response: '',
    })

    const res = await fetch(`${MITAKE_ENDPOINT}?CharsetURL=UTF-8`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: params,
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) {
      throw new Error(`三竹簡訊 HTTP ${res.status}`)
    }

    const body = await res.text()
    const parsed = parseMitakeResponse(body)

    if (!parsed.ok) {
      throw new Error(`三竹簡訊發送失敗（statuscode=${parsed.statusCode ?? 'n/a'}）：${body.trim()}`)
    }

    return { messageId: parsed.msgId }
  }
}

const ACCEPTED_STATUS_CODES = new Set(['0', '1', '2', '4'])

export function parseMitakeResponse(body: string): {
  ok: boolean
  msgId: string | null
  statusCode: string | null
} {
  const kv = new Map<string, string>()
  for (const line of body.split(/\r?\n/)) {
    const idx = line.indexOf('=')
    if (idx > 0) kv.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim())
  }
  const statusCode = kv.get('statuscode') ?? null
  return {
    ok: statusCode !== null && ACCEPTED_STATUS_CODES.has(statusCode),
    msgId: kv.get('msgid') ?? null,
    statusCode,
  }
}
