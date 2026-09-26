import { describe, it, expect } from 'vitest'
import type { z } from 'zod'
import {
  availablePaymentChoices,
  holdMinutesFor,
  isBankTransferAvailable,
  isCodAvailable,
  isPaymentChoice,
  paymentSettingsSchema,
  shippingFeesOf,
  shippingSettingsSchema,
  CVS_COLLECTION_MAX,
  type PaymentSettings,
} from './shop-settings'

/** 用 schema 的 input 型別，這樣 methods 可以只給要覆寫的那幾個 */
const settings = (
  overrides: z.input<typeof paymentSettingsSchema> = {},
): PaymentSettings => paymentSettingsSchema.parse(overrides)

const BANK_ACCOUNT = {
  bankTransferEnabled: true,
  bankName: '玉山銀行',
  bankCode: '808',
  bankAccountNo: '0123456789012',
  bankAccountName: '莎岡選品有限公司',
} as const

describe('paymentSettingsSchema', () => {
  it('空物件會補出一套可用的預設值', () => {
    const parsed = settings()
    expect(parsed.prepayEnabled).toBe(true)
    expect(parsed.codEnabled).toBe(false)
    // 付款期限預設 2 天 —— 超商代碼 30 分鐘到期對消費者太短
    expect(parsed.cvsExpireDays).toBe(2)
    expect(parsed.atmExpireDays).toBe(2)
    expect(parsed.methods).toEqual({ Credit: true, ATM: false, CVS: true, BARCODE: true })
  })

  it('舊資料只有一部分欄位時，其餘補預設值而不是整份丟掉', () => {
    const parsed = paymentSettingsSchema.parse({ codEnabled: true, methods: { ATM: false } })
    expect(parsed.codEnabled).toBe(true)
    expect(parsed.methods.ATM).toBe(false)
    expect(parsed.methods.Credit).toBe(true)
    expect(parsed.refundWindowDays).toBe(7)
  })

  it('期限超出綠界允許範圍時解析失敗（而不是送出去被退件）', () => {
    expect(paymentSettingsSchema.safeParse({ cvsExpireDays: 31 }).success).toBe(false)
    expect(paymentSettingsSchema.safeParse({ cvsExpireDays: 0 }).success).toBe(false)
    expect(paymentSettingsSchema.safeParse({ cvsExpireDays: 30 }).success).toBe(true)
  })
})

describe('shippingSettingsSchema', () => {
  it('空物件補出綠界／黑貓的實收價與預設免運門檻', () => {
    expect(shippingSettingsSchema.parse({})).toEqual({
      cvsFee: 65,
      homeFee: 130,
      freeShippingThreshold: 2000,
    })
  })

  it('舊資料少一欄時只補那一欄', () => {
    expect(shippingSettingsSchema.parse({ cvsFee: 70 })).toMatchObject({ cvsFee: 70, homeFee: 130 })
  })

  it('負數運費與 0 元門檻都擋下', () => {
    expect(shippingSettingsSchema.safeParse({ cvsFee: -1 }).success).toBe(false)
    expect(shippingSettingsSchema.safeParse({ freeShippingThreshold: 0 }).success).toBe(false)
    // 運費 0 是合法的（店家全額吸收）
    expect(shippingSettingsSchema.safeParse({ homeFee: 0 }).success).toBe(true)
  })

  it('shippingFeesOf 轉成 calculatePricing 要的形狀', () => {
    expect(shippingFeesOf(shippingSettingsSchema.parse({}))).toEqual({ CVS: 65, HOME: 130 })
  })
})

describe('holdMinutesFor — 庫存要保留多久', () => {
  it('超商與 ATM 跟著設定的天數走', () => {
    const s = settings({ cvsExpireDays: 2, atmExpireDays: 3 })
    expect(holdMinutesFor('CVS', s)).toBe(2 * 24 * 60)
    expect(holdMinutesFor('BARCODE', s)).toBe(2 * 24 * 60)
    expect(holdMinutesFor('ATM', s)).toBe(3 * 24 * 60)
  })

  it('匯款跟著匯款期限的天數走', () => {
    expect(holdMinutesFor('BANK', settings({ bankExpireDays: 3 }))).toBe(3 * 24 * 60)
  })

  it('貨到付款不等付款，不需要保留期限', () => {
    expect(holdMinutesFor('COD', settings())).toBe(0)
  })

  it('信用卡只需要留住填卡號的那幾分鐘，跟著後台設定走', () => {
    expect(holdMinutesFor('Credit', settings())).toBe(30)
    expect(holdMinutesFor('Credit', settings({ creditHoldMinutes: 90 }))).toBe(90)
  })
})

describe('isCodAvailable', () => {
  it('沒開就是不能用', () => {
    expect(isCodAvailable(settings({ codEnabled: false }), 'CVS', 1000)).toBe(false)
  })

  it('只開超商時宅配不能貨到付款', () => {
    const s = settings({ codEnabled: true, codShippingMethods: ['CVS'] })
    expect(isCodAvailable(s, 'CVS', 1000)).toBe(true)
    expect(isCodAvailable(s, 'HOME', 1000)).toBe(false)
  })

  it('超商代收有 20,000 上限，設定調高也一樣（綠界會退件 10500040）', () => {
    const s = settings({ codEnabled: true, codMaxAmount: 50_000 })
    expect(isCodAvailable(s, 'CVS', CVS_COLLECTION_MAX)).toBe(true)
    expect(isCodAvailable(s, 'CVS', CVS_COLLECTION_MAX + 1)).toBe(false)
    // 宅配是黑貓代收，沒有這個上限
    expect(isCodAvailable(s, 'HOME', 30_000)).toBe(true)
  })

  it('金額 0 元不給貨到付款（沒有錢可以代收）', () => {
    expect(isCodAvailable(settings({ codEnabled: true }), 'CVS', 0)).toBe(false)
  })
})

describe('isBankTransferAvailable', () => {
  it('帳戶填齊才算開放', () => {
    expect(isBankTransferAvailable(settings(BANK_ACCOUNT))).toBe(true)
  })

  it('沒開就是不能用', () => {
    expect(isBankTransferAvailable(settings({ ...BANK_ACCOUNT, bankTransferEnabled: false }))).toBe(
      false,
    )
  })

  it('開關開著但帳戶少一格時當作沒開（顯示殘缺的帳號客人根本轉不了）', () => {
    for (const missing of ['bankName', 'bankCode', 'bankAccountNo', 'bankAccountName'] as const) {
      expect(isBankTransferAvailable(settings({ ...BANK_ACCOUNT, [missing]: '' }))).toBe(false)
    }
  })
})

describe('availablePaymentChoices', () => {
  it('關掉線上付款後只剩貨到付款', () => {
    const s = settings({ prepayEnabled: false, codEnabled: true })
    expect(availablePaymentChoices(s, 'CVS', 1000)).toEqual(['COD'])
  })

  it('個別關掉的付款方式不會出現在選項裡', () => {
    const s = settings({ methods: { ATM: false, BARCODE: false } })
    expect(availablePaymentChoices(s, 'CVS', 1000)).toEqual(['Credit', 'CVS'])
  })

  it('匯款不受 prepayEnabled 影響（它不是綠界的方式）', () => {
    const s = settings({ prepayEnabled: false, ...BANK_ACCOUNT })
    expect(availablePaymentChoices(s, 'HOME', 1000)).toEqual(['BANK'])
  })

  it('全關掉時回空陣列（結帳頁要據此顯示錯誤而不是給出無效選項）', () => {
    const s = settings({ prepayEnabled: false, codEnabled: false })
    expect(availablePaymentChoices(s, 'HOME', 1000)).toEqual([])
  })
})

describe('isPaymentChoice', () => {
  it('只認識我們支援的六種', () => {
    expect(isPaymentChoice('COD')).toBe(true)
    expect(isPaymentChoice('BANK')).toBe(true)
    expect(isPaymentChoice('Credit')).toBe(true)
    // ALL 是綠界的「顯示所有付款方式」，我們不讓消費者選它
    expect(isPaymentChoice('ALL')).toBe(false)
    expect(isPaymentChoice('WeiXin')).toBe(false)
  })
})
