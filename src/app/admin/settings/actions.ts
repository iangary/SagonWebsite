'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { audit } from '@/lib/audit'
import {
  getPaymentSettings,
  paymentSettingsSchema,
  savePaymentSettings,
} from '@/lib/shop-settings'

export type SettingsState = { ok: boolean; message?: string; error?: string }

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
  const int = (name: string, fallback: number) => {
    const raw = formData.get(name)
    const parsed = Number.parseInt(typeof raw === 'string' ? raw : '', 10)
    return Number.isFinite(parsed) ? parsed : fallback
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
    cvsExpireDays: int('cvsExpireDays', 2),
    atmExpireDays: int('atmExpireDays', 2),
    refundWindowDays: int('refundWindowDays', 7),
  })

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '設定值不合法' }
  }

  // 兩邊都關掉的話消費者結不了帳，直接擋下來比讓他們在結帳頁踩到好
  if (!parsed.data.prepayEnabled && !parsed.data.codEnabled) {
    return { ok: false, error: '線上付款與貨到付款不能同時關閉，否則消費者無法結帳' }
  }
  if (parsed.data.prepayEnabled && !Object.values(parsed.data.methods).some(Boolean)) {
    return { ok: false, error: '開放線上付款時至少要留一種付款方式' }
  }
  if (parsed.data.codEnabled && codShippingMethods.length === 0) {
    return { ok: false, error: '開放貨到付款時至少要選一種可用的配送方式' }
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

  revalidatePath('/admin/settings')
  // 結帳頁與訂單頁都會讀這份設定
  revalidatePath('/checkout')

  return { ok: true, message: '設定已儲存' }
}
