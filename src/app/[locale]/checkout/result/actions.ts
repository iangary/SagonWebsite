'use server'

import { z } from 'zod'
import { getTranslations } from 'next-intl/server'
import { resolveOrderAccess } from '@/lib/orders/access'
import { cancelUnpaidOrderNow } from '@/lib/orders/cancel'
import { enqueue } from '@/lib/queue'
import { changePaymentMethod, PaymentMethodConflict } from '@/lib/orders/payment-method'
import { isPaymentChoice } from '@/lib/shop-settings'

/**
 * 消費者自己在訂單頁上能動的事：改付款方式、取消還沒付款的訂單。
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
  /** 這一頁的內容變了（例如改成匯款要顯示帳號），前端要重新取一次 */
  refresh?: boolean
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

    switch (result.kind) {
      case 'ecpay':
        return { ok: true, redirectTo: result.redirectTo }
      case 'cod':
        return { ok: true, message: '已改為貨到付款，我們會開始為您備貨。' }
      case 'bank':
        // 帳號就在這一頁上，重新整理才看得到 —— 由 PaymentSwitcher 觸發
        return { ok: true, refresh: true, message: '已改為匯款付款，請依下方的匯款資訊完成轉帳。' }
    }
  } catch (error) {
    if (error instanceof PaymentMethodConflict) return { ok: false, error: error.message }
    console.error('[order] 改付款方式失敗', error)
    return { ok: false, error: '系統忙碌中，請稍後再試' }
  }
}

const cancelSchema = z.object({
  orderNo: z.string().trim().min(1),
  contact: z.string().trim().optional().default(''),
})

/**
 * 消費者取消自己還沒付款的訂單。
 *
 * 只開放 PENDING_PAYMENT —— 已付款的要退錢、貨到付款的已經在備貨，
 * 這兩種都得經過店家，走 LINE 客服。
 */
export async function cancelOrderAction(
  _prev: OrderActionState,
  formData: FormData,
): Promise<OrderActionState> {
  const parsed = cancelSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { ok: false, error: '參數不完整' }

  const { orderNo, contact } = parsed.data
  const access = await resolveOrderAccess({ orderNo, contact: contact || undefined })
  if (!access.ok) return accessError(access.error)

  const t = await getTranslations('result')
  try {
    const cancelled = await cancelUnpaidOrderNow(access.orderId)
    // 搶輸了：這段時間付款剛好進來，或在別的分頁已經取消過
    if (!cancelled) return { ok: false, refresh: true, error: t('cancelOrderNotPending') }
  } catch (error) {
    console.error('[order] 消費者取消訂單失敗', error)
    return { ok: false, error: '系統忙碌中，請稍後再試' }
  }

  // 信寄不出去不影響取消本身
  await enqueue('send-email', {
    template: 'order-cancelled-by-customer',
    orderId: access.orderId,
  }).catch((error) => console.error('[order] 取消通知信排程失敗', error))

  // 頁面重新整理後會顯示「訂單已取消」，不另外回訊息
  return { ok: true, refresh: true }
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
