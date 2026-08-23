import 'server-only'
import type { PaymentSettings } from '@/lib/shop-settings'

/**
 * 匯款到公司帳戶的共用細節。
 *
 * 這個付款方式沒有金流商 —— 錢直接進公司的銀行帳戶，所以：
 *   1. 沒有取號步驟，帳號在下單那一刻就已經知道（設定裡那組）
 *   2. **沒有任何入帳通知**，要有人去看帳戶，再到後台按「標記匯款已入帳」
 *      （見 lib/orders/payment.ts 的 markBankTransferPaid）
 *   3. 帳戶資訊不存進 payments —— 只有一組公司帳戶，存快照只會讓
 *      「換帳號之後舊訂單還印著已停用的帳號」變成新的客服問題
 */

export interface BankAccount {
  bankName: string
  bankCode: string
  accountNo: string
  accountName: string
  /** 給客人的補充說明，例如「請在轉帳備註填訂單編號」。空字串代表不顯示。 */
  note: string
}

export function bankAccountOf(settings: PaymentSettings): BankAccount {
  return {
    bankName: settings.bankName,
    bankCode: settings.bankCode,
    accountNo: settings.bankAccountNo,
    accountName: settings.bankAccountName,
    note: settings.bankTransferNote,
  }
}

/**
 * 匯款期限，寫進 payment.expireDate 給前後台顯示。
 *
 * 一定要與庫存預扣的到期時間同一個算法（都是 holdMinutesFor('BANK')），
 * 否則會出現「畫面說還能匯到明天、訂單今晚就被排程取消」。
 *
 * 格式帶到分鐘而不是只有日期：這個時間就是訂單被自動取消的那一刻，
 * 只寫日期會讓客人以為那天整天都還來得及。ATM／超商的 expireDate 是綠界給的
 * 日期字串，兩種格式並存沒關係，都只是顯示用。
 */
export function formatTransferDeadline(deadline: Date): string {
  const parts = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(deadline)

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''

  return `${get('year')}/${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`
}
