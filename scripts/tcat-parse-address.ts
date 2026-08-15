/**
 * 查地址對應的黑貓郵碼（統一速達 ParsingAddress API）。
 *
 * 兩個用途：
 *   1. 取得 TCAT_SENDER_ZIP —— 寄件地址的黑貓郵碼「後六碼」。
 *      這不是中華郵政的郵遞區號，非查不可，填錯建單會被 E057 退件。
 *   2. 當成最便宜的憑證檢查 —— 這支 API 是唯讀的、沒有副作用，
 *      能查到郵碼就代表 TCAT_CUSTOMER_ID / TCAT_CUSTOMER_TOKEN 是對的。
 *
 * 用法：
 *   npx tsx --env-file-if-exists=.env --conditions=react-server \
 *     scripts/tcat-parse-address.ts "台北市中山區中山北路一段1號"
 *
 * 可以一次帶多個地址。要打正式站就把 .env 的 TCAT_ENV 改成 production。
 */

const addresses = process.argv.slice(2)

if (addresses.length === 0) {
  console.error('用法：scripts/tcat-parse-address.ts "地址1" ["地址2" ...]')
  process.exit(1)
}

const IS_STAGE = (process.env.TCAT_ENV ?? 'stage') === 'stage'
const BASE = IS_STAGE
  ? 'https://egs.suda.com.tw:8443/api/Egs'
  : 'https://api.suda.com.tw/api/Egs'

const customerId = process.env.TCAT_CUSTOMER_ID
const customerToken = process.env.TCAT_CUSTOMER_TOKEN

if (!customerId || !customerToken) {
  console.error('缺少 TCAT_CUSTOMER_ID / TCAT_CUSTOMER_TOKEN，請先設定 .env')
  process.exit(1)
}

interface ParsingAddressResponse {
  SrvTranId: string
  IsOK: 'Y' | 'N'
  Message: string
  Data: { Addresses: { Search: string; PostNumber: string }[] } | null
}

async function main() {
  console.info(`環境：${IS_STAGE ? '測試站' : '正式站'}（${BASE}）`)
  console.info(`契客代號：${customerId}\n`)

  const res = await fetch(`${BASE}/ParsingAddress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      CustomerId: customerId,
      CustomerToken: customerToken,
      PostType: '01',
      Addresses: addresses.map((Search) => ({ Search })),
    }),
    signal: AbortSignal.timeout(120_000),
  })

  if (!res.ok) {
    console.error(`HTTP ${res.status}`, await res.text().catch(() => ''))
    process.exit(1)
  }

  const body = (await res.json()) as ParsingAddressResponse

  if (body.IsOK !== 'Y' || !body.Data) {
    console.error(`查詢失敗：${body.Message}`)
    // 單筆查不到就是 IsOK=N；多筆查不到會是 PostNumber 空字串（規格 2.1.2 第 9 項）
    console.error('可能原因：地址有誤、該地址不在配送範圍，或授權碼不正確。')
    process.exit(1)
  }

  for (const { Search, PostNumber } of body.Data.Addresses) {
    if (!PostNumber) {
      console.info(`✗ ${Search}\n    查無郵碼（地址可能有誤）\n`)
      continue
    }
    if (PostNumber === 'X') {
      console.info(`✗ ${Search}\n    黑貓不配送此地址（例如部分離島）\n`)
      continue
    }

    // 規格 2.2.1 第 20 項：SenderZipCode 要的是「後六碼」
    const six = PostNumber.replace(/[^0-9A-Za-z]/g, '').toUpperCase().slice(-6)
    console.info(`✓ ${Search}`)
    console.info(`    黑貓郵碼：${PostNumber}`)
    console.info(`    TCAT_SENDER_ZIP=${six}\n`)
  }
}

main().catch((err) => {
  console.error('查詢失敗：', err)
  process.exit(1)
})
