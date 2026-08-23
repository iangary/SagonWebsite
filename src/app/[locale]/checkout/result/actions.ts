'use server'

import { z } from 'zod'
import { resolveOrderAccess } from '@/lib/orders/access'
import { changePaymentMethod, PaymentMethodConflict } from '@/lib/orders/payment-method'
import { isPaymentChoice } from '@/lib/shop-settings'

/**
 * 消費者自己在訂單頁上唯一能動的事：改付款方式。
 *
 * 要先過 resolveOrderAccess —— 訂單編號印在出貨單上，
 * 光靠編號就能把別人的繳費代碼作廢是不行的。
 *
 * 退款與退換貨沒有線上表單，一律走 LINE 客服（見 refund-contact.tsx）。
 */

export type OrderActionState = {
  ok: boolean
  error?: string
  message?: string
  /** 需要導向綠界收銀台時才有 */
  redirectTo?: string
  /** 訪客要補 Email／手機驗證身分 */
  needsContact?: boolean
}

const changeSchema = z.object({
  orderNo: z.string().trim().min(1),
  contact: z.string().trim().optional().default(''),
  choice: z.string().trim().min(1),
})

export async function changePaymentAction(
  _prev: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  const parsed = changeSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { ok: false, error: '參數不完整' }

  const { orderNo, contact, choice } = parsed.data
  if (!isPaymentChoice(choice)) return { ok: false, error: '不支援的付款方式' }

  const access = await resolveOrderAccess({ orderNo, contact: contact || undefined })
  if (!access.ok) return accessError(access.error)

  try {
    const result = await changePaymentMethod({ orderId: access.orderId, choice })
    if (!result.ok) return { ok: false, error: result.error }

    return result.kind === 'ecpay'
      ? { ok: true, redirectTo: result.redirectTo }
      : { ok: true, message: '已改為貨到付款，我們會開始為您備貨。' }
  } catch (error) {
    if (error instanceof PaymentMethodConflict) return { ok: false, error: error.message }
    console.error('[order] 改付款方式失敗', error)
    return { ok: false, error: '系統忙碌中，請稍後再試' }
  }
}

function accessError(error: 'NOT_FOUND' | 'CONTACT_REQUIRED' | 'CONTACT_MISMATCH'): OrderActionState {
  switch (error) {
    case 'NOT_FOUND':
      return { ok: false, error: '找不到這張訂單' }
    case 'CONTACT_REQUIRED':
      return { ok: false, needsContact: true, error: '請輸入訂購時填的 Email 或手機以確認身分' }
    case 'CONTACT_MISMATCH':
      return { ok: false, needsContact: true, error: 'Email 或手機與訂單不符' }
  }
}
