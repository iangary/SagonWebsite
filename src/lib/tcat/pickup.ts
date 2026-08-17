import type { TcatPickupRequest } from './client'
import { normalizeMobile, sanitizeAddress, sanitizeName, splitTel } from './fields'

/**
 * 組出「呼叫黑貓」（規格 2.6 Call）的電文。
 *
 * 跟 order.ts 一樣是純函式，理由也一樣：這支 API 打出去就有真人開車過來，
 * 不能靠打到測試站試錯，只能靠測試把欄位規則釘死。
 */

export interface TcatPickupInput {
  /** 契約客戶名稱，允許空白 */
  customerName: string
  contactName: string
  /** '' / '01' 男 / '02' 女 */
  contactGender: string
  contactTel?: string | null
  contactMobile: string
  contactAddress: string
  /** 常溫件數。我們沒有低溫商品，冷藏冷凍固定 0 */
  quantity: number
  isContact: boolean
  isTrolley: boolean
  memo?: string
}

export class TcatPickupInvalid extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TcatPickupInvalid'
  }
}

/** 備註 String(100)。 */
function sanitizeMemo(memo: string | undefined): string {
  if (!memo) return ''
  return [...memo.replace(/\s+/g, ' ').trim()].slice(0, 100).join('')
}

export function buildPickupCall(input: TcatPickupInput): TcatPickupRequest {
  const contactName = sanitizeName(input.contactName)
  const tel = splitTel(input.contactTel)
  const contactMobile = normalizeMobile(input.contactMobile)
  const contactAddress = sanitizeAddress(input.contactAddress)

  if (!contactName) {
    throw new TcatPickupInvalid('聯絡人姓名清洗後是空的，請檢查 TCAT_PICKUP_CONTACT_NAME／ECPAY_SENDER_NAME')
  }
  // 規格 2.6.1 第 6~9 項：聯絡人電話、手機擇一必填
  if (!tel.number && !contactMobile) {
    throw new TcatPickupInvalid('聯絡人電話與手機都不是有效格式，請檢查 ECPAY_SENDER_PHONE／ECPAY_SENDER_CELLPHONE')
  }
  if (!contactAddress) {
    throw new TcatPickupInvalid('收貨地址是空的，請檢查 ECPAY_SENDER_ADDRESS')
  }
  // 叫車來收 0 件沒有意義，而且司機白跑一趟
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new TcatPickupInvalid('出貨件數必須是 1 以上的整數')
  }

  return {
    CustomerName: sanitizeName(input.customerName),
    ContactName: contactName,
    ContactGender: input.contactGender,
    ContactTelArea: tel.area,
    ContactTelNumber: tel.number,
    ContactTelExt: tel.ext,
    ContactMobile: contactMobile,
    ContactAddress: contactAddress,
    NormalQuantity: input.quantity,
    ColdQuantity: 0,
    FreezeQuantity: 0,
    IsContact: input.isContact ? 'Y' : 'N',
    IsTrolley: input.isTrolley ? 'Y' : 'N',
    Memo: sanitizeMemo(input.memo),
  }
}
