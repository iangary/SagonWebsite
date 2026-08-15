import 'server-only'
import { env } from '@/lib/env'

/**
 * 統一速達「印單 API 平台」的端點與契客憑證。
 *
 * 規格：docs/黑貓宅急便_物流系統串接_標準印單API參考文件_v2.1.2/
 *       02 標準印單API串接架構及說明/印單API平台_API規格書_契客_v2.1.2_20260325.pdf
 *
 * 與綠界完全不同的地方：沒有簽章機制（CheckMacValue 那一套用不上），
 * 憑證是直接放在 JSON body 裡的 CustomerId / CustomerToken。
 */

const IS_STAGE = env.TCAT_ENV === 'stage'

/**
 * 服務網址是 {base}/{服務名稱}。
 * 正式站另有備援 https://api.suda.net.tw:9443/api/Egs —— 目前沒做自動切換，
 * 真的遇到主站故障時改這裡的常數即可。
 */
const BASE = IS_STAGE
  ? 'https://egs.suda.com.tw:8443/api/Egs'
  : 'https://api.suda.com.tw/api/Egs'

export function tcatEndpoint(service: TcatService): string {
  return `${BASE}/${service}`
}

/** 規格書 2.x 的「服務名稱」。 */
export type TcatService =
  | 'ParsingAddress'
  | 'PrintOBT'
  | 'DownloadOBT'
  | 'OBTStatus'

export const tcatConfig = {
  customerId: env.TCAT_CUSTOMER_ID,
  customerToken: env.TCAT_CUSTOMER_TOKEN,
  senderZip: env.TCAT_SENDER_ZIP,
  obtType: env.TCAT_OBT_TYPE,
  productTypeId: env.TCAT_PRODUCT_TYPE_ID,
  defaultSpec: env.TCAT_DEFAULT_SPEC,
  specQtyStep: env.TCAT_SPEC_QTY_STEP,
  isStage: IS_STAGE,
}

/**
 * 規格書明講「當服務繁忙時，連線逾時時間請設定最少 120 秒」。
 * 綠界那邊我們用 30 秒，這裡不能照抄。
 */
export const TCAT_TIMEOUT_MS = 120_000

/** 各支 API 的單次資料筆數上限（規格書 2.1.1 / 2.2.1 / 2.11.2）。 */
export const TCAT_LIMITS = {
  parsingAddress: 100,
  printObt: 100,
  obtStatus: 10,
} as const
