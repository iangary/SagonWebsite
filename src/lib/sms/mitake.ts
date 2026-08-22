import 'server-only'
import { randomUUID } from 'node:crypto'
import { env } from '@/lib/env'
import type { SmsProvider, SmsSendResult } from './provider'

/**
 * 三竹簡訊（Mitake）B2C API v2.14。
 * 文件：docs/三竹/B2C_MitakeAPI_v2.14.md、docs/mitake-sms-integration.html
 *
 * 端點由 MITAKE_ENDPOINT 決定（`/b2c/mtk` 是 B2C 版、`/api/mtk` 是企業版，不可互打）。
 *
 * 回應是 INI 風格的純文字，不是 JSON：
 *   [1]
 *   msgid=#000000013
 *   statuscode=1
 *   AccountPoint=126
 *
 * 三竹「回 HTTP 200 但 statuscode 是錯誤碼」是常態，所以 res.ok 不代表發送成功。
 */

/** 這些 statuscode 代表三竹已受理（附錄一／二）。5~9 與所有英文字母皆為失敗。 */
const ACCEPTED_STATUS_CODES = new Set(['0', '1', '2', '4'])

/**
 * 三竹端的暫時性狀況，退避後重試才有意義：
 * a／b（簡訊發送功能暫時停止服務）、r（系統暫停服務）、l（帳號已達同時連線數上限）。
 * 其餘錯誤（帳密錯、IP 未登記、權限未開）重試一百次也一樣。
 */
const RETRYABLE_STATUS_CODES = new Set(['a', 'b', 'r', 'l'])

/** 餘額低於此值就開始示警。三竹點數用完會回 statuscode=s，屆時手機登入會全站掛掉。 */
const LOW_BALANCE_THRESHOLD = 100

export class MitakeError extends Error {
  constructor(
    message: string,
    readonly statusCode: string | null,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'MitakeError'
  }
}

export class MitakeSmsProvider implements SmsProvider {
  readonly name = 'mitake'

  async send(to: string, text: string, clientId?: string): Promise<SmsSendResult> {
    if (!env.MITAKE_USERNAME || !env.MITAKE_PASSWORD) {
      throw new Error('SMS_PROVIDER=mitake 但未設定 MITAKE_USERNAME / MITAKE_PASSWORD')
    }

    const params = new URLSearchParams({
      username: env.MITAKE_USERNAME,
      password: env.MITAKE_PASSWORD,
      dstaddr: to,
      smbody: formatSmsBody(text),
      // clientid 是三竹的冪等機制：12 小時內同一個 ID 不會真的重送，只會回上次結果 + Duplicate=Y。
      // 呼叫端重試時要沿用同一個；使用者主動「重新發送」則必須換新的，否則收不到第二則。
      clientid: clientId ?? randomUUID(),
    })

    // 中文欄位預設會被當 Big5 解，CharsetURL 一定要指定；URLSearchParams 已做好 URL Encode
    const res = await fetch(`${env.MITAKE_ENDPOINT}/SmSend?CharsetURL=UTF-8`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: params,
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) {
      // HTTP 層失敗無從得知三竹是否已收下，當作可重試 —— 但呼叫端必須沿用 clientid，
      // 否則就是規格書第 4 頁警告的「省略查詢直接重送造成重複發送」。
      throw new MitakeError(`三竹簡訊 HTTP ${res.status}`, null, true)
    }

    const parsed = parseMitakeResponse(await res.text())

    if (!parsed.ok) {
      // 錯誤訊息只留在 server 端，不要把三竹的原始回應丟給前端
      throw new MitakeError(
        `三竹簡訊發送失敗（statuscode=${parsed.statusCode ?? 'n/a'}）`,
        parsed.statusCode,
        parsed.statusCode !== null && RETRYABLE_STATUS_CODES.has(parsed.statusCode),
      )
    }

    if (parsed.accountPoint !== null && parsed.accountPoint < LOW_BALANCE_THRESHOLD) {
      console.warn(`[mitake] 簡訊點數僅剩 ${parsed.accountPoint} 點，歸零後手機 OTP 登入會失效`)
    }

    return {
      messageId: parsed.msgId,
      accountPoint: parsed.accountPoint,
      duplicate: parsed.duplicate,
    }
  }
}

/**
 * 三竹的 smbody 換行要填 ASCII Code 6，不是 `\n`（規格書 SmSend／SmBulkSend 的 smbody 欄位）。
 * 目前 OTP 是單行用不到，先擋住日後加訂單、出貨通知簡訊時直接寫 `\n` 的地雷。
 */
function formatSmsBody(text: string): string {
  return text.replace(/\r?\n/g, '\x06')
}

export function parseMitakeResponse(body: string): {
  ok: boolean
  msgId: string | null
  statusCode: string | null
  accountPoint: number | null
  duplicate: boolean
} {
  const kv = new Map<string, string>()
  for (const line of body.split(/\r?\n/)) {
    const idx = line.indexOf('=')
    if (idx > 0) kv.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim())
  }

  const statusCode = kv.get('statuscode') ?? null
  // 空字串要當成「沒有這個欄位」—— Number('') 是 0，會被誤讀成點數歸零並誤觸低餘額警告
  const rawPoint = kv.get('AccountPoint')
  const point = rawPoint === undefined || rawPoint === '' ? Number.NaN : Number(rawPoint)

  return {
    ok: statusCode !== null && ACCEPTED_STATUS_CODES.has(statusCode),
    // SmSend 回的 msgid 帶 # 前綴（msgid=#000000013），但 SmQuery 與 callback 用的是不帶 #
    // 的純序號。存進 DB 前先剝掉，否則日後拿去查會得到 statuscode=z（查無資料）。
    msgId: kv.get('msgid')?.replace(/^#/, '') ?? null,
    statusCode,
    accountPoint: Number.isFinite(point) ? point : null,
    duplicate: kv.get('Duplicate') === 'Y',
  }
}
