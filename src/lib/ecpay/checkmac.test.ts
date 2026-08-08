import { describe, it, expect } from 'vitest'
import {
  buildRawString,
  dotNetUrlEncode,
  generateCheckMacValue,
  verifyCheckMacValue,
} from './checkmac'

/**
 * 這組 golden test 直接取自綠界官方文件的 CheckMacValue 計算範例。
 * 只要這裡綠燈，就代表排序、URL encode、大小寫、雜湊四個環節都跟綠界一致。
 * 文件：https://developers.ecpay.com.tw/?p=2902
 */
const OFFICIAL_CREDENTIALS = {
  hashKey: 'pwFHCqoQZGmho4w6',
  hashIV: 'EkRm7iFT261dpevs',
}

const OFFICIAL_PARAMS = {
  MerchantID: '3002607',
  MerchantTradeNo: 'ecpay20230312153023',
  MerchantTradeDate: '2023/03/12 15:30:23',
  PaymentType: 'aio',
  TotalAmount: '30000',
  TradeDesc: '促銷方案',
  ItemName: 'Apple iphone 15',
  ReturnURL: 'https://www.ecpay.com.tw/receive.php',
  ChoosePayment: 'ALL',
  EncryptType: '1',
}

const OFFICIAL_RAW =
  'HashKey=pwFHCqoQZGmho4w6' +
  '&ChoosePayment=ALL' +
  '&EncryptType=1' +
  '&ItemName=Apple iphone 15' +
  '&MerchantID=3002607' +
  '&MerchantTradeDate=2023/03/12 15:30:23' +
  '&MerchantTradeNo=ecpay20230312153023' +
  '&PaymentType=aio' +
  '&ReturnURL=https://www.ecpay.com.tw/receive.php' +
  '&TotalAmount=30000' +
  '&TradeDesc=促銷方案' +
  '&HashIV=EkRm7iFT261dpevs'

const OFFICIAL_ENCODED =
  'hashkey%3dpwfhcqoqzgmho4w6%26choosepayment%3dall%26encrypttype%3d1' +
  '%26itemname%3dapple+iphone+15%26merchantid%3d3002607' +
  '%26merchanttradedate%3d2023%2f03%2f12+15%3a30%3a23' +
  '%26merchanttradeno%3decpay20230312153023%26paymenttype%3daio' +
  '%26returnurl%3dhttps%3a%2f%2fwww.ecpay.com.tw%2freceive.php' +
  '%26totalamount%3d30000%26tradedesc%3d%e4%bf%83%e9%8a%b7%e6%96%b9%e6%a1%88' +
  '%26hashiv%3dekrm7ift261dpevs'

const OFFICIAL_SHA256 = '6C51C9E6888DE861FD62FB1DD17029FC742634498FD813DC43D4243B5685B840'

describe('CheckMacValue — 綠界官方範例', () => {
  it('第 2 步的排序與串接結果與文件一致', () => {
    expect(buildRawString(OFFICIAL_PARAMS, OFFICIAL_CREDENTIALS)).toBe(OFFICIAL_RAW)
  })

  it('第 3-4 步的 URL encode 與轉小寫結果與文件一致', () => {
    expect(dotNetUrlEncode(OFFICIAL_RAW).toLowerCase()).toBe(OFFICIAL_ENCODED)
  })

  it('SHA256 的最終簽章與文件一致', () => {
    expect(generateCheckMacValue(OFFICIAL_PARAMS, OFFICIAL_CREDENTIALS, 'sha256')).toBe(
      OFFICIAL_SHA256,
    )
  })

  it('參數順序不影響結果（排序後才簽章）', () => {
    const shuffled = Object.fromEntries(Object.entries(OFFICIAL_PARAMS).reverse())
    expect(generateCheckMacValue(shuffled, OFFICIAL_CREDENTIALS)).toBe(OFFICIAL_SHA256)
  })
})

describe('dotNetUrlEncode 與 encodeURIComponent 的差異', () => {
  it('空白編成 +', () => {
    expect(dotNetUrlEncode('a b')).toBe('a+b')
  })

  it('單引號與波浪號要編碼（encodeURIComponent 不會編）', () => {
    expect(dotNetUrlEncode("it's")).toBe('it%27s')
    expect(dotNetUrlEncode('~x')).toBe('%7ex')
  })

  it('-_.!*() 保持原樣', () => {
    expect(dotNetUrlEncode("-_.!*()")).toBe('-_.!*()')
  })
})

describe('verifyCheckMacValue', () => {
  it('簽章正確時通過', () => {
    const params = { ...OFFICIAL_PARAMS, CheckMacValue: OFFICIAL_SHA256 }
    expect(verifyCheckMacValue(params, OFFICIAL_CREDENTIALS)).toBe(true)
  })

  it('任何欄位被竄改都會失敗', () => {
    const params = {
      ...OFFICIAL_PARAMS,
      TotalAmount: '1',
      CheckMacValue: OFFICIAL_SHA256,
    }
    expect(verifyCheckMacValue(params, OFFICIAL_CREDENTIALS)).toBe(false)
  })

  it('沒有 CheckMacValue 直接視為失敗', () => {
    expect(verifyCheckMacValue(OFFICIAL_PARAMS, OFFICIAL_CREDENTIALS)).toBe(false)
  })

  it('CheckMacValue 本身不會被算進簽章', () => {
    const withMac = { ...OFFICIAL_PARAMS, CheckMacValue: 'WHATEVER' }
    expect(generateCheckMacValue(withMac, OFFICIAL_CREDENTIALS)).toBe(OFFICIAL_SHA256)
  })
})
