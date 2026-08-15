import { describe, it, expect, vi } from 'vitest'

// webhook.ts 頂層 import '@/lib/db'，單元測試沒有資料庫，換成空物件。
// （recordWebhook 等會碰資料庫的部分由整合測試覆蓋，這裡只測純函式 deriveExternalId。）
vi.mock('@/lib/db', () => ({ db: {} }))

import { deriveExternalId } from './webhook'

describe('deriveExternalId — 業務主鍵優先序', () => {
  it('MerchantTradeNo > AllPayLogisticsID > TradeNo > unknown', () => {
    const all = {
      MerchantTradeNo: 'MTN001',
      AllPayLogisticsID: 'LOG001',
      TradeNo: 'TN001',
    }
    expect(deriveExternalId('payment_return', all)).toMatch(/^MTN001:/)

    const noMtn = { AllPayLogisticsID: 'LOG001', TradeNo: 'TN001' }
    expect(deriveExternalId('logistics_reply', noMtn)).toMatch(/^LOG001:/)

    const onlyTradeNo = { TradeNo: 'TN001' }
    expect(deriveExternalId('payment_return', onlyTradeNo)).toMatch(/^TN001:/)

    expect(deriveExternalId('payment_return', { RtnCode: '1' })).toMatch(/^unknown:/)
  })
})

describe('deriveExternalId — fingerprint 特性', () => {
  const base = { MerchantTradeNo: 'MTN001', RtnCode: '1', TradeAmt: '1000' }

  it('CheckMacValue 不參與 fingerprint：有無 CheckMacValue 得到同一個 id', () => {
    const withMac = { ...base, CheckMacValue: 'ABCDEF123456' }
    expect(deriveExternalId('payment_return', withMac)).toBe(
      deriveExternalId('payment_return', base),
    )
  })

  it('key 插入順序不影響結果（排序後才雜湊）', () => {
    const reversed = Object.fromEntries(Object.entries(base).reverse())
    expect(deriveExternalId('payment_return', reversed)).toBe(
      deriveExternalId('payment_return', base),
    )
  })

  it('任一其他欄位變動就會產生不同的 fingerprint', () => {
    const original = deriveExternalId('payment_return', base)
    expect(deriveExternalId('payment_return', { ...base, RtnCode: '2' })).not.toBe(original)
    expect(deriveExternalId('payment_return', { ...base, TradeAmt: '999' })).not.toBe(original)
    expect(deriveExternalId('payment_return', { ...base, Extra: 'x' })).not.toBe(original)
  })

  it('格式為 businessKey + 冒號 + 16 位小寫 hex', () => {
    expect(deriveExternalId('payment_return', base)).toMatch(/^MTN001:[0-9a-f]{16}$/)
  })

  it('空物件回傳 unknown:<hash>，仍是穩定的 16 位 hex', () => {
    const id = deriveExternalId('payment_info', {})
    expect(id).toMatch(/^unknown:[0-9a-f]{16}$/)
    expect(deriveExternalId('payment_info', {})).toBe(id) // 同輸入必同輸出
  })
})
