import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  actualExpireMinutes,
  buildAioCheckoutParams,
  buildItemName,
  formatTradeDate,
  generateMerchantTradeNo,
  isPaymentSuccessful,
  isSimulatedPayment,
  type AioOrderInput,
} from './aio'
import { verifyCheckMacValue } from './checkmac'
import { paymentConfig } from './config'

/** 產生一筆最小可用的訂單輸入，個別測試再覆寫需要的欄位 */
function baseInput(overrides: Partial<AioOrderInput> = {}): AioOrderInput {
  return {
    merchantTradeNo: 'SGTEST0001',
    totalAmount: 1000,
    tradeDesc: '測試訂單',
    items: [{ name: '茶葉', qty: 2, unitPrice: 500 }],
    choosePayment: 'Credit',
    ...overrides,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('buildAioCheckoutParams — 基本契約', () => {
  it('固定參數與網址正確：MerchantID 來自 env、aio、SHA256、額外付款資訊', () => {
    const params = buildAioCheckoutParams(baseInput())

    expect(params.MerchantID).toBe('3002607')
    expect(params.PaymentType).toBe('aio')
    expect(params.EncryptType).toBe('1')
    expect(params.NeedExtraPaidInfo).toBe('Y')
    expect(params.TotalAmount).toBe('1000')
    expect(params.ChoosePayment).toBe('Credit')
    expect(params.ReturnURL).toBe('http://localhost:3000/api/ecpay/payment/return')
    expect(params.OrderResultURL).toBe('http://localhost:3000/api/ecpay/payment/result')
    expect(params.ClientBackURL).toBe('http://localhost:3000/cart')
  })

  it('產出的 CheckMacValue 可通過 verifyCheckMacValue 驗證（round-trip）', () => {
    const params = buildAioCheckoutParams(baseInput())
    expect(params.CheckMacValue).toMatch(/^[0-9A-F]{64}$/)
    expect(verifyCheckMacValue(params, paymentConfig.credentials, 'sha256')).toBe(true)
  })

  it('ATM/CVS/BARCODE 有 PaymentInfoURL、信用卡沒有', () => {
    for (const choosePayment of ['ATM', 'CVS', 'BARCODE'] as const) {
      const params = buildAioCheckoutParams(baseInput({ choosePayment }))
      expect(params.PaymentInfoURL).toBe('http://localhost:3000/api/ecpay/payment/info')
    }
    const credit = buildAioCheckoutParams(baseInput({ choosePayment: 'Credit' }))
    expect(credit).not.toHaveProperty('PaymentInfoURL')
  })

  it('CustomField1 有傳才出現', () => {
    const without = buildAioCheckoutParams(baseInput())
    expect(without).not.toHaveProperty('CustomField1')

    const withField = buildAioCheckoutParams(baseInput({ customField1: 'order-123' }))
    expect(withField.CustomField1).toBe('order-123')
  })
})

describe('actualExpireMinutes — 各付款方式的實際生效期限', () => {
  it('信用卡不受期限影響，原值返回', () => {
    expect(actualExpireMinutes('Credit', 30)).toBe(30)
  })

  it('ATM 以「天」為單位無條件進位，下限 1 天', () => {
    expect(actualExpireMinutes('ATM', 30)).toBe(1440) // 30 分鐘 → 1 天
    expect(actualExpireMinutes('ATM', 1441)).toBe(2880) // 超過 1 天 → 進位到 2 天
    expect(actualExpireMinutes('ATM', 2880)).toBe(2880) // 剛好 2 天不進位
  })

  it('CVS/BARCODE 以分鐘為單位，夾在 1 ~ 43200 之間', () => {
    expect(actualExpireMinutes('CVS', 30)).toBe(30)
    expect(actualExpireMinutes('CVS', 0)).toBe(1) // 下限 clamp（build 只在 truthy 時呼叫，但函式本身要守住）
    expect(actualExpireMinutes('CVS', 50000)).toBe(43200)
    expect(actualExpireMinutes('BARCODE', 50000)).toBe(43200)
  })
})

describe('buildAioCheckoutParams — 期限參數', () => {
  it('ATM 單的 ExpireDate 以天計：30 分鐘 → 1 天、1441 分鐘 → 2 天', () => {
    const oneDay = buildAioCheckoutParams(baseInput({ choosePayment: 'ATM', expireMinutes: 30 }))
    expect(oneDay.ExpireDate).toBe('1')
    expect(oneDay).not.toHaveProperty('StoreExpireDate')

    const twoDays = buildAioCheckoutParams(baseInput({ choosePayment: 'ATM', expireMinutes: 1441 }))
    expect(twoDays.ExpireDate).toBe('2')
  })

  it('CVS 單的 StoreExpireDate 以分鐘計，超過上限截到 43200', () => {
    const short = buildAioCheckoutParams(baseInput({ choosePayment: 'CVS', expireMinutes: 30 }))
    expect(short.StoreExpireDate).toBe('30')
    expect(short).not.toHaveProperty('ExpireDate')

    const long = buildAioCheckoutParams(baseInput({ choosePayment: 'CVS', expireMinutes: 50000 }))
    expect(long.StoreExpireDate).toBe('43200')
  })

  it('信用卡即使傳 expireMinutes 也不會出現期限參數', () => {
    const params = buildAioCheckoutParams(baseInput({ choosePayment: 'Credit', expireMinutes: 30 }))
    expect(params).not.toHaveProperty('ExpireDate')
    expect(params).not.toHaveProperty('StoreExpireDate')
  })
})

describe('buildItemName', () => {
  it('單品格式為 name NT$price x qty，多筆用 # 相連', () => {
    expect(buildItemName([{ name: '茶葉', qty: 2, unitPrice: 500 }])).toBe('茶葉 NT$500 x 2')
    expect(
      buildItemName([
        { name: '茶葉', qty: 2, unitPrice: 500 },
        { name: '茶壺', qty: 1, unitPrice: 1200 },
      ]),
    ).toBe('茶葉 NT$500 x 2#茶壺 NT$1200 x 1')
  })

  it('商品名稱裡的 # 換成全形＃，避免破壞分隔符', () => {
    expect(buildItemName([{ name: 'A#B#C', qty: 1, unitPrice: 100 }])).toBe('A＃B＃C NT$100 x 1')
  })

  it('超過 400 字元時截到 397 + "..."，總長不超過 400', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      name: `商品${i}`.padEnd(30, 'x'),
      qty: 1,
      unitPrice: 100,
    }))
    const result = buildItemName(items)
    expect(result.length).toBe(400)
    expect(result.endsWith('...')).toBe(true)
  })

  it('剛好 400 字元不截斷', () => {
    const name = 'x'.repeat(400 - ' NT$100 x 1'.length)
    const result = buildItemName([{ name, qty: 1, unitPrice: 100 }])
    expect(result.length).toBe(400)
    expect(result.endsWith('...')).toBe(false)
  })
})

describe('formatTradeDate', () => {
  it('格式固定為 yyyy/MM/dd HH:mm:ss', () => {
    expect(formatTradeDate()).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  it('固定系統時間時輸出台北時區（UTC+8）的值', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2023-03-12T07:30:23Z')) // 台北 15:30:23
    expect(formatTradeDate()).toBe('2023/03/12 15:30:23')
  })

  it('跨日邊界：UTC 深夜換算成台北隔天凌晨', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2023-12-31T18:00:00Z')) // 台北 2024/01/01 02:00:00
    expect(formatTradeDate()).toBe('2024/01/01 02:00:00')
  })
})

describe('generateMerchantTradeNo', () => {
  it('僅大寫英數、最長 20 碼、保留 prefix', () => {
    const no = generateMerchantTradeNo()
    expect(no).toMatch(/^[A-Z0-9]+$/)
    expect(no.length).toBeLessThanOrEqual(20)
    expect(no.startsWith('SG')).toBe(true)

    const custom = generateMerchantTradeNo('TEST')
    expect(custom.startsWith('TEST')).toBe(true)
    expect(custom.length).toBeLessThanOrEqual(20)
  })

  it('連續產生 1000 次不重複', () => {
    const seen = new Set(Array.from({ length: 1000 }, () => generateMerchantTradeNo()))
    expect(seen.size).toBe(1000)
  })
})

describe('付款結果判讀', () => {
  it('isPaymentSuccessful：RtnCode 為 1 才算成功', () => {
    expect(isPaymentSuccessful({ RtnCode: '1' })).toBe(true)
    expect(isPaymentSuccessful({ RtnCode: '10100073' })).toBe(false) // CVS 取號成功不是付款成功
    expect(isPaymentSuccessful({})).toBe(false)
  })

  it('isSimulatedPayment：SimulatePaid 為 1 代表模擬付款', () => {
    expect(isSimulatedPayment({ SimulatePaid: '1' })).toBe(true)
    expect(isSimulatedPayment({ SimulatePaid: '0' })).toBe(false)
  })
})
