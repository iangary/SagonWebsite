import { describe, it, expect } from 'vitest'
import {
  buildEnvelope,
  buildIssuePayload,
  decryptReceiptData,
  encryptReceiptData,
  receiptDate,
} from './receipt'

const input = {
  relateNumber: 'SGTEST001',
  name: '王小明',
  email: 'test@example.com',
  phone: '0912345678',
  items: [
    { name: '測試商品', count: 2, price: 500 },
    { name: '運費', count: 1, price: 70 },
  ],
  amount: 1070,
}

describe('AES 加解密', () => {
  it('加密後可以解回原本的物件', () => {
    const data = { RelateNumber: 'SG001', Amount: 1070, Name: '王小明' }
    expect(decryptReceiptData(encryptReceiptData(data))).toEqual(data)
  })

  it('Base64 用標準 alphabet，不能是 URL-safe 的 -_', () => {
    // 用 URL-safe alphabet 綠界會解不開
    const cipher = encryptReceiptData({ note: '~!*()中文 空白' })
    expect(cipher).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
  })

  it('中文與特殊字元 round-trip 不會壞掉', () => {
    const data = { Name: '莎岡選品店', Note: 'a+b&c=d /ABC1234 ~' }
    expect(decryptReceiptData(encryptReceiptData(data))).toEqual(data)
  })
})

describe('buildEnvelope', () => {
  it('RqHeader 只有 Timestamp，不帶 Revision', () => {
    // 電子發票的 RqHeader 要帶 Revision，電子收據不用 —— 帶了會被退件
    const envelope = buildEnvelope({ foo: 'bar' })

    expect(Object.keys(envelope.RqHeader)).toEqual(['Timestamp'])
    expect(envelope.RqHeader).not.toHaveProperty('Revision')
  })

  it('Timestamp 是 Unix 秒數，不是毫秒', () => {
    const { Timestamp } = buildEnvelope({}).RqHeader

    expect(Number.isInteger(Timestamp)).toBe(true)
    // 毫秒會是 13 位數，綠界只收秒數
    expect(String(Timestamp)).toHaveLength(10)
    expect(Math.abs(Timestamp - Math.floor(Date.now() / 1000))).toBeLessThan(5)
  })
})

describe('buildIssuePayload', () => {
  it('固定用一般收據與電子索取', () => {
    const payload = buildIssuePayload(input)

    expect(payload.ReceiptType).toBe(1)
    expect(payload.RetrievalMethod).toBe(2)
    // RetrievalMethod=2 時 Email 必填
    expect(payload.Email).toBe('test@example.com')
  })

  it('Items 的 ItemAmount 是數量乘單價，且加總等於 Amount', () => {
    const payload = buildIssuePayload(input)
    const items = payload.Items as { ItemSeq: number; ItemAmount: number }[]

    expect(items.map((i) => i.ItemSeq)).toEqual([1, 2])
    expect(items.map((i) => i.ItemAmount)).toEqual([1000, 70])
    // 加總對不上 Amount 會被綠界退件
    expect(items.reduce((sum, i) => sum + i.ItemAmount, 0)).toBe(payload.Amount)
  })

  it('折扣以負數品項呈現，加總仍等於 Amount', () => {
    const payload = buildIssuePayload({
      ...input,
      items: [...input.items, { name: '折扣', count: 1, price: -70 }],
      amount: 1000,
    })
    const items = payload.Items as { ItemAmount: number }[]

    expect(items.reduce((sum, i) => sum + i.ItemAmount, 0)).toBe(1000)
  })
})

describe('receiptDate', () => {
  it('用台北時間的 yyyy/MM/dd HH:mm:ss', () => {
    expect(receiptDate(new Date('2026-08-15T01:23:45Z'))).toBe('2026/08/15 09:23:45')
  })
})
