'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { audit } from '@/lib/audit'
import {
  getPaymentSettings,
  getShippingSettings,
  paymentSettingsSchema,
  savePaymentSettings,
  saveShippingSettings,
  shippingSettingsSchema,
} from '@/lib/shop-settings'

export type SettingsState = { ok: boolean; message?: string; error?: string }

/** 表單送上來的數字欄位是字串；空的或打錯就用 fallback，值域交給 zod 擋 */
function intField(formData: FormData, name: string, fallback: number): number {
  const raw = formData.get(name)
  const parsed = Number.parseInt(typeof raw === 'string' ? raw : '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

/**
 * 運費與付款設定都會出現在前台每一頁（公告列的免運門檻）或有 ISR 的頁面
 * （常見問題、服務條款），只清結帳頁不夠 —— 後台是低頻操作，整站清掉最不會漏。
 */
function revalidateStorefront() {
  revalidatePath('/', 'layout')
}

/** 儲存運費設定。 */
export async function saveShippingSettingsAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const admin = await requireAdmin()

  const before = await getShippingSettings()
  const parsed = shippingSettingsSchema.safeParse({
    cvsFee: intField(formData, 'cvsFee', before.cvsFee),
    homeFee: intField(formData, 'homeFee', before.homeFee),
    freeShippingThreshold: intField(formData, 'freeShippingThreshold', before.freeShippingThreshold),
  })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '設定值不合法' }
  }

  await saveShippingSettings(parsed.data, admin.id)

  await audit({
    userId: admin.id,
    action: 'settings.shipping',
    entity: 'ShopSetting',
    entityId: 'shipping',
    before,
    after: parsed.data,
  })

  revalidateStorefront()

  return { ok: true, message: '運費設定已儲存' }
}

/**
 * 儲存付款設定。
 *
 * 表單送上來的都是字串，checkbox 沒勾選時根本不會出現在 FormData 裡，
 * 所以這裡先把它整理成正確的型別再交給 zod 驗（值域與上下限都在 schema 上）。
 */
export async function saveSettingsAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const admin = await requireAdmin()

  const bool = (name: string) => formData.get(name) === 'on'
  const int = (name: string, fallback: number) => intField(formData, name, fallback)

  const text = (name: string) => {
    const raw = formData.get(name)
    return typeof raw === 'string' ? raw.trim() : ''
  }

  const codShippingMethods = (['CVS', 'HOME'] as const).filter((m) => bool(`cod_${m}`))

  const parsed = paymentSettingsSchema.safeParse({
    prepayEnabled: bool('prepayEnabled'),
    methods: {
      Credit: bool('method_Credit'),
      ATM: bool('method_ATM'),
      CVS: bool('method_CVS'),
      BARCODE: bool('method_BARCODE'),
    },
    codEnabled: bool('codEnabled'),
    codShippingMethods,
    codFee: int('codFee', 0),
    codMaxAmount: int('codMaxAmount', 20_000),
    bankTransferEnabled: bool('bankTransferEnabled'),
    bankName: text('bankName'),
    bankCode: text('bankCode'),
    bankAccountNo: text('bankAccountNo'),
    bankAccountName: text('bankAccountName'),
    bankExpireDays: int('bankExpireDays', 3),
    bankTransferNote: text('bankTransferNote'),
    cvsExpireDays: int('cvsExpireDays', 2),
    atmExpireDays: int('atmExpireDays', 2),
    creditHoldMinutes: int('creditHoldMinutes', 30),
    refundWindowDays: int('refundWindowDays', 7),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '設定值不合法' }
  }

  // 全部關掉的話消費者結不了帳，直接擋下來比讓他們在結帳頁踩到好
  if (
    !parsed.data.prepayEnabled &&
    !parsed.data.codEnabled &&
    !parsed.data.bankTransferEnabled
  ) {
    return { ok: false, error: '線上付款、匯款與貨到付款不能全部關閉，否則消費者無法結帳' }
  }
  if (parsed.data.prepayEnabled && !Object.values(parsed.data.methods).some(Boolean)) {
    return { ok: false, error: '開放線上付款時至少要留一種付款方式' }
  }
  if (parsed.data.codEnabled && codShippingMethods.length === 0) {
    return { ok: false, error: '開放貨到付款時至少要選一種可用的配送方式' }
  }

  // 帳戶少一格客人就轉不了帳。前台有 isBankTransferAvailable 兜底（殘缺就當沒開），
  // 但那是靜默的 —— 在這裡明講哪一格沒填，店長才知道為什麼結帳頁沒出現匯款。
  if (parsed.data.bankTransferEnabled) {
    const bank = parsed.data
    if (!bank.bankName) return { ok: false, error: '開放匯款付款時要填銀行名稱' }
    if (!/^[0-9]{3,4}$/.test(bank.bankCode)) {
      return { ok: false, error: '銀行代號是 3 碼數字（郵局為 700）' }
    }
    if (!/^[0-9-]{5,20}$/.test(bank.bankAccountNo)) {
      return { ok: false, error: '帳號只能是數字與連字號，長度 5~20 碼' }
    }
    if (!bank.bankAccountName) return { ok: false, error: '開放匯款付款時要填戶名' }
  }

  const before = await getPaymentSettings()
  await savePaymentSettings(parsed.data, admin.id)

  await audit({
    userId: admin.id,
    action: 'settings.payment',
    entity: 'ShopSetting',
    entityId: 'payment',
    before,
    after: parsed.data,
  })

  // 結帳頁、訂單頁與服務條款（保留期限）都會讀這份設定
  revalidateStorefront()

  return { ok: true, message: '付款設定已儲存' }
}
