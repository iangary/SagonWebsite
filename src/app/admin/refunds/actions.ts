'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth'
import { audit } from '@/lib/audit'
import {
  approveRefund,
  completeManualRefund,
  openRefundRequest,
  rejectRefund,
  type RefundActionResult,
} from '@/lib/orders/refund'

/**
 * 退款的後台操作。
 *
 * 退款單有兩種來源：客服在 LINE 上與客人談定後手動開（adminCreateRefund），
 * 以及系統自己偵測到重複付款／逾期入帳時開的（見 lib/orders/payment.ts）。
 * 前台沒有線上申請表單。
 *
 * 開單之後三個動作對應三種結果：
 *   同意 → 信用卡當場退刷；其他付款方式轉「待人工匯款」
 *   完成 → 人工匯款做完了（信用卡退刷成功時由同意那一步直接走完）
 *   不受理 → 記原因並通知消費者
 */

const noteSchema = z.string().trim().min(1, '請填寫說明').max(500, '說明最多 500 字')

const createSchema = z.object({
  orderId: z.string().min(1),
  reason: z.string().trim().min(2, '請寫下退款原因（客人在 LINE 上說的重點）').max(500),
  // 人工匯款的帳戶。開單時可以先空著，匯款前補上就好。
  bankCode: z
    .string()
    .trim()
    .regex(/^\d{3,7}$/, '銀行代碼請填 3 碼（例如 812）或含分行的 7 碼')
    .optional()
    .or(z.literal('')),
  bankAccountNo: z
    .string()
    .trim()
    .regex(/^[\d-]{6,30}$/, '銀行帳號只能是數字與連字號')
    .optional()
    .or(z.literal('')),
  accountName: z.string().trim().max(50).optional(),
  overrideWindow: z.boolean().optional(),
})

/**
 * 客服開一張退款單。
 *
 * 客人是在 LINE 上談的，所以原因與收款帳戶都由客服代填 ——
 * 這支就是把那段對話的結論落到系統裡，後面的審核與退刷流程與系統自動開的單一致。
 */
export async function adminCreateRefund(input: {
  orderId: string
  reason: string
  bankCode?: string
  bankAccountNo?: string
  accountName?: string
  overrideWindow?: boolean
}): Promise<RefundActionResult> {
  const admin = await requireAdmin()

  const parsed = createSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '參數錯誤' }
  }

  try {
    const result = await openRefundRequest({
      orderId: parsed.data.orderId,
      reason: parsed.data.reason,
      bankCode: parsed.data.bankCode || undefined,
      bankAccountNo: parsed.data.bankAccountNo || undefined,
      accountName: parsed.data.accountName || undefined,
      overrideWindow: parsed.data.overrideWindow,
    })
    if (!result.ok) return { ok: false, error: result.error }

    await audit({
      userId: admin.id,
      action: 'refund.open',
      entity: 'RefundRequest',
      entityId: result.refundId,
      after: { orderId: parsed.data.orderId, reason: parsed.data.reason },
    })

    revalidateRefundViews()
    revalidatePath(`/admin/orders/${parsed.data.orderId}`)
    return { ok: true, message: '已建立退款單，請在退款頁或下方按「同意」開始處理' }
  } catch (error) {
    console.error('[admin] 建立退款單失敗', error)
    return { ok: false, error: (error as Error).message }
  }
}

export async function adminApproveRefund(refundId: string): Promise<RefundActionResult> {
  const admin = await requireAdmin()

  try {
    const result = await approveRefund(refundId, admin.id)
    await audit({
      userId: admin.id,
      action: 'refund.approve',
      entity: 'RefundRequest',
      entityId: refundId,
      after: { ok: result.ok },
    })
    revalidateRefundViews()
    return result
  } catch (error) {
    console.error('[admin] 同意退款失敗', error)
    return { ok: false, error: (error as Error).message }
  }
}

export async function adminCompleteRefund(
  refundId: string,
  note?: string,
): Promise<RefundActionResult> {
  const admin = await requireAdmin()

  try {
    const result = await completeManualRefund(refundId, admin.id, note?.trim() || undefined)
    await audit({
      userId: admin.id,
      action: 'refund.complete',
      entity: 'RefundRequest',
      entityId: refundId,
      after: { note },
    })
    revalidateRefundViews()
    return result
  } catch (error) {
    console.error('[admin] 標記退款完成失敗', error)
    return { ok: false, error: (error as Error).message }
  }
}

export async function adminRejectRefund(
  refundId: string,
  note: string,
): Promise<RefundActionResult> {
  const admin = await requireAdmin()

  const parsed = noteSchema.safeParse(note)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '參數錯誤' }
  }

  try {
    const result = await rejectRefund(refundId, admin.id, parsed.data)
    await audit({
      userId: admin.id,
      action: 'refund.reject',
      entity: 'RefundRequest',
      entityId: refundId,
      after: { note: parsed.data },
    })
    revalidateRefundViews()
    return result
  } catch (error) {
    console.error('[admin] 拒絕退款失敗', error)
    return { ok: false, error: (error as Error).message }
  }
}

function revalidateRefundViews(): void {
  revalidatePath('/admin/refunds')
  // 訂單頁也會顯示退款區塊，狀態改了要一起更新
  revalidatePath('/admin/orders')
}
