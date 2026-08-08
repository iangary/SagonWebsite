/**
 * 用正確簽章模擬綠界的背景通知，打進本站的 callback 端點。
 *
 * 為什麼需要這支：
 *   信用卡付款成功的 ReturnURL 通知，只有真的刷卡才會由綠界發出。
 *   開發與自動化測試時不可能每次都去刷卡，所以用相同的 HashKey/HashIV
 *   自己簽一份一模一樣的通知，驗證我們這端的處理邏輯（驗簽、冪等、
 *   庫存實扣、派送物流與發票工作）。
 *
 * 這只是「模擬綠界的請求」，不會產生任何金流；正式環境不該執行。
 *
 * 用法：
 *   npx tsx --env-file-if-exists=.env --conditions=react-server \
 *     scripts/simulate-ecpay-callback.ts payment-return <orderNo>
 */

import { createHash } from 'node:crypto'

const [, , kind, orderNo] = process.argv

if (!kind || !orderNo) {
  console.error('用法：simulate-ecpay-callback.ts <payment-return|payment-info> <orderNo>')
  process.exit(1)
}

if (process.env.ECPAY_ENV === 'production') {
  console.error('拒絕在 ECPAY_ENV=production 下執行。')
  process.exit(1)
}

const appUrl = process.env.APP_URL
const hashKey = process.env.ECPAY_HASH_KEY
const hashIV = process.env.ECPAY_HASH_IV
const merchantId = process.env.ECPAY_MERCHANT_ID

if (!appUrl || !hashKey || !hashIV || !merchantId) {
  console.error('缺少 APP_URL / ECPAY_MERCHANT_ID / ECPAY_HASH_KEY / ECPAY_HASH_IV')
  process.exit(1)
}

/** 與 src/lib/ecpay/checkmac.ts 相同的演算法，這裡刻意獨立實作以免測到自己的 bug。 */
function sign(params: Record<string, string>): string {
  const body = Object.entries(params)
    .filter(([k]) => k !== 'CheckMacValue')
    .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase(), 'en'))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')

  const raw = `HashKey=${hashKey}&${body}&HashIV=${hashIV}`
  const encoded = encodeURIComponent(raw)
    .replace(/%20/g, '+')
    .replace(/'/g, '%27')
    .replace(/~/g, '%7e')
    .toLowerCase()

  return createHash('sha256').update(encoded, 'utf8').digest('hex').toUpperCase()
}

function tradeDate(): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const d = new Date()
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

async function main() {
  // 金額必須與訂單一致，否則我們的處理器會（正確地）拒絕
  const statusRes = await fetch(new URL(`/api/orders/${orderNo}/status`, appUrl))
  if (!statusRes.ok) {
    console.error(`查不到訂單 ${orderNo}`)
    process.exit(1)
  }

  const amountRes = await fetch(new URL(`/api/orders/${orderNo}/amount`, appUrl))
  if (!amountRes.ok) {
    console.error('取不到訂單金額，請確認 /api/orders/[orderNo]/amount 是否可用')
    process.exit(1)
  }
  const { grandTotal } = (await amountRes.json()) as { grandTotal: number }

  const base: Record<string, string> = {
    MerchantID: merchantId!,
    MerchantTradeNo: orderNo!,
    StoreID: '',
    RtnMsg: '',
    RtnCode: '',
    TradeNo: `SIM${Date.now()}`,
    TradeAmt: String(grandTotal),
    PaymentDate: tradeDate(),
    PaymentType: '',
    PaymentTypeChargeFee: '0',
    TradeDate: tradeDate(),
    SimulatePaid: '1',
    CustomField1: '',
    CustomField2: '',
    CustomField3: '',
    CustomField4: '',
  }

  let path: string
  if (kind === 'payment-return') {
    path = '/api/ecpay/payment/return'
    base.RtnCode = '1'
    base.RtnMsg = '交易成功'
    base.PaymentType = 'Credit_CreditCard'
  } else {
    path = '/api/ecpay/payment/info'
    base.RtnCode = '2'
    base.RtnMsg = 'Get VirtualAccount Succeeded'
    base.PaymentType = 'ATM_TAISHIN'
    base.BankCode = '812'
    base.vAccount = '9990012345678901'
    base.ExpireDate = '2026/12/31'
  }

  base.CheckMacValue = sign(base)

  const url = new URL(path, appUrl).toString()
  console.log(`POST ${url}`)

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(base),
  })

  console.log(`← ${res.status} ${await res.text()}`)
}

await main()
