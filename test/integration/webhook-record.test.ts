import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import {
  deriveExternalId,
  markWebhookFailed,
  markWebhookProcessed,
  readCallbackParams,
  recordWebhook,
} from '@/lib/ecpay/webhook'

/**
 * WebhookEvent 落地與冪等：綠界重送（同 payload）要擋掉，
 * 同訂單的新狀態（不同 payload）要當新事件。
 */

function baseParams(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    MerchantID: '3002607',
    MerchantTradeNo: 'TESTWH0001',
    RtnCode: '1',
    RtnMsg: '交易成功',
    TradeAmt: '560',
    CheckMacValue: 'FAKECHECKMAC',
    ...overrides,
  }
}

describe('recordWebhook', () => {
  it('首次記錄會建立事件，alreadyProcessed=false，payload 與 signatureValid 都存進資料庫', async () => {
    const params = baseParams()

    const event = await recordWebhook('payment_return', params, true)

    expect(event.alreadyProcessed).toBe(false)
    expect(event.externalId).toBe(deriveExternalId('payment_return', params))

    const row = await db.webhookEvent.findUniqueOrThrow({ where: { id: event.id } })
    expect(row.provider).toBe('ECPAY')
    expect(row.kind).toBe('payment_return')
    expect(row.merchantTradeNo).toBe('TESTWH0001')
    expect(row.payload).toEqual(params)
    expect(row.signatureValid).toBe(true)
    expect(row.processedAt).toBeNull()
    expect(row.attempts).toBe(0)
  })

  it('同樣的 params 再記一次會拿到同一個事件 id，處理前 alreadyProcessed 仍為 false', async () => {
    const params = baseParams()

    const first = await recordWebhook('payment_return', params, true)
    const second = await recordWebhook('payment_return', params, true)

    expect(second.id).toBe(first.id)
    expect(second.alreadyProcessed).toBe(false)
    expect(await db.webhookEvent.count()).toBe(1)
  })

  it('markWebhookProcessed 之後同樣的 params 會回 alreadyProcessed=true', async () => {
    const params = baseParams()

    const first = await recordWebhook('payment_return', params, true)
    await markWebhookProcessed(first.id)

    const resend = await recordWebhook('payment_return', params, true)
    expect(resend.id).toBe(first.id)
    expect(resend.alreadyProcessed).toBe(true)
  })

  it('同一筆訂單但 payload 不同（狀態推進）會產生不同 externalId 的新事件', async () => {
    const created = await recordWebhook('logistics_reply', baseParams({ RtnCode: '300' }), true)
    const arrived = await recordWebhook('logistics_reply', baseParams({ RtnCode: '2063' }), true)

    expect(arrived.id).not.toBe(created.id)
    expect(arrived.externalId).not.toBe(created.externalId)
    expect(await db.webhookEvent.count()).toBe(2)
  })

  it('markWebhookFailed 會存 error 並遞增 attempts；之後成功會把 error 清空', async () => {
    const event = await recordWebhook('payment_return', baseParams(), true)

    await markWebhookFailed(event.id, new Error('付款金額不符'))

    let row = await db.webhookEvent.findUniqueOrThrow({ where: { id: event.id } })
    expect(row.attempts).toBe(1)
    expect(row.error).toContain('付款金額不符')
    expect(row.processedAt).toBeNull()

    await markWebhookProcessed(event.id)

    row = await db.webhookEvent.findUniqueOrThrow({ where: { id: event.id } })
    expect(row.attempts).toBe(2)
    expect(row.error).toBeNull()
    expect(row.processedAt).not.toBeNull()
  })

  it('併發收到兩個一模一樣的回拋時，兩邊都能 resolve、拿到同一個事件、資料庫恰好一筆（P2002 修復）', async () => {
    const params = baseParams({ MerchantTradeNo: 'TESTRACE01' })

    // 兩個 recordWebhook 同時跑：find 都撲空、create 其中一個撞唯一鍵，
    // 撞到的那個要重讀而不是把 P2002 丟出去（否則 route 回 500，綠界會一直重送）
    const [a, b] = await Promise.all([
      recordWebhook('payment_return', params, true),
      recordWebhook('payment_return', params, true),
    ])

    expect(a.id).toBe(b.id)
    expect(a.alreadyProcessed).toBe(false)
    expect(b.alreadyProcessed).toBe(false)

    const rows = await db.webhookEvent.findMany({
      where: { merchantTradeNo: 'TESTRACE01' },
    })
    expect(rows).toHaveLength(1)
  })
})

describe('readCallbackParams', () => {
  it('支援 form-urlencoded（綠界的預設格式）', async () => {
    const req = new Request('http://localhost:3000/api/ecpay/payment/return', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        MerchantTradeNo: 'TESTFORM01',
        RtnMsg: '交易成功（含中文與符號 &=+）',
      }).toString(),
    })

    const params = await readCallbackParams(req)
    expect(params.MerchantTradeNo).toBe('TESTFORM01')
    expect(params.RtnMsg).toBe('交易成功（含中文與符號 &=+）')
  })

  it('支援 application/json', async () => {
    const req = new Request('http://localhost:3000/api/ecpay/payment/return', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ MerchantTradeNo: 'TESTJSON01', RtnCode: '1' }),
    })

    const params = await readCallbackParams(req)
    expect(params).toEqual({ MerchantTradeNo: 'TESTJSON01', RtnCode: '1' })
  })
})
