import 'server-only'
import type { OrderStatus, Payment, RefundRequest, Shipment } from '@prisma/client'
import { db } from '@/lib/db'
import { enqueue } from '@/lib/queue'
import { isCreditCardPayment, refundCreditCard } from '@/lib/ecpay/refund'
import { getPaymentSettings } from '@/lib/shop-settings'
import { currentPaymentOf } from './payment'

/**
 * 退款：客服在 LINE 上與客人談定 → 後台開一張退款單 → 審核 → 實際退錢。
 *
 * 前台沒有線上申請表單（訂單頁只給 LINE 客服入口，見 result/refund-contact.tsx）。
 * 理由：退款要先確認商品狀態、瑕疵照片、退回方式與收款帳戶，用對話處理最快；
 * 表單只會讓客人填完之後還是得等客服私訊他。
 *
 * 系統自己也會開退款單 —— 重複付款與逾期入帳（見 payment.ts 的
 * openSystemRefundRequest），那些是「錢收了但不該收」，不能等人發現。
 *
 * 退錢的手段取決於當初怎麼付的：
 *   - 信用卡        綠界 CreditDetail/DoAction（Action=R）可以線上退刷
 *   - ATM／超商／貨到付款  綠界**沒有**退款 API（消費者是臨櫃付現／轉帳），
 *                    只能請消費者提供帳戶後人工匯款
 * 所以 RefundRequest 一定要記下 method，後台才知道這筆是「按一下就退」
 * 還是「要有人去銀行操作」。
 */

export interface RefundEligibility {
  eligible: boolean
  /** 不能退款的原因 */
  reasonKey?: 'notPaid' | 'alreadyRequested' | 'windowClosed' | 'cancelled' | 'refunded'
  /** 這筆退款只能人工匯款（非信用卡付款），後台開單時要提醒客服問帳戶 */
  needsBankAccount: boolean
}

type OrderForEligibility = {
  status: OrderStatus
  paidAt: Date | null
  payments: Payment[]
  shipment: Pick<Shipment, 'status' | 'updatedAt'> | null
  refunds: Pick<RefundRequest, 'status'>[]
}

/**
 * 這張訂單現在還能不能退款。
 *
 * 前台用它決定要不要顯示「聯繫 LINE 客服」的入口，後台用它擋掉不該開的退款單。
 *
 * 期限的算法：還沒收到貨（備貨中／已出貨）隨時可以申請；已取貨（COMPLETED）
 * 才開始算 refundWindowDays。用出貨日算會很不合理 —— 超商放到店 7 天，
 * 消費者第 6 天才去領，猶豫期已經過完了。
 */
export function refundEligibility(
  order: OrderForEligibility,
  settings: { refundWindowDays: number },
  now: Date = new Date(),
): RefundEligibility {
  const payment = currentPaymentOf(order.payments)
  const needsBankAccount = !payment || !isCreditCardPayment(payment.choosePayment, payment.paymentType)

  if (order.status === 'REFUNDED') {
    return { eligible: false, reasonKey: 'refunded', needsBankAccount }
  }
  if (order.status === 'CANCELLED') {
    return { eligible: false, reasonKey: 'cancelled', needsBankAccount }
  }
  // 貨到付款在取貨前根本還沒付錢，要的是「取消訂單」而不是退款
  const paid = order.payments.some((p) => p.status === 'PAID')
  if (!paid) {
    return { eligible: false, reasonKey: 'notPaid', needsBankAccount }
  }
  if (order.refunds.some((r) => r.status === 'REQUESTED' || r.status === 'APPROVED')) {
    return { eligible: false, reasonKey: 'alreadyRequested', needsBankAccount }
  }

  if (order.status === 'COMPLETED') {
    const received = order.shipment?.updatedAt ?? order.paidAt ?? now
    const deadline = new Date(received.getTime() + settings.refundWindowDays * 24 * 60 * 60 * 1000)
    if (now > deadline) {
      return { eligible: false, reasonKey: 'windowClosed', needsBankAccount }
    }
  }

  return { eligible: true, needsBankAccount }
}

export interface OpenRefundInput {
  orderId: string
  /** 客服填的原因（多半是把 LINE 上談的結論摘一句） */
  reason: string
  /** 人工匯款的收款帳戶。客人在 LINE 上給的，可以之後再補。 */
  bankCode?: string
  bankAccountNo?: string
  accountName?: string
  /** 超過期限時仍要開單（客服判斷的個案，會記在原因裡） */
  overrideWindow?: boolean
}

export type OpenRefundResult = { ok: true; refundId: string } | { ok: false; error: string }

/**
 * 後台開一張退款單。
 *
 * 期限與重複申請的檢查照樣做 —— 但客服可以用 overrideWindow 明確跨過期限，
 * 因為「超過 7 天但商品有瑕疵」這種個案是客服的職權，不是系統該擋的。
 */
export async function openRefundRequest(input: OpenRefundInput): Promise<OpenRefundResult> {
  const settings = await getPaymentSettings()

  const order = await db.order.findUnique({
    where: { id: input.orderId },
    select: {
      id: true,
      status: true,
      paidAt: true,
      grandTotal: true,
      userId: true,
      payments: true,
      shipment: { select: { status: true, updatedAt: true } },
      refunds: { select: { status: true } },
    },
  })
  if (!order) return { ok: false, error: '找不到訂單' }

  const eligibility = refundEligibility(order, settings)
  if (!eligibility.eligible) {
    const overridable = eligibility.reasonKey === 'windowClosed' && input.overrideWindow
    if (!overridable) {
      return { ok: false, error: refundRejectionMessage(eligibility.reasonKey) }
    }
  }

  const payment = order.payments.find((p) => p.status === 'PAID') ?? currentPaymentOf(order.payments)

  const refund = await db.refundRequest.create({
    data: {
      orderId: order.id,
      paymentId: payment?.id ?? null,
      userId: order.userId,
      amount: order.grandTotal,
      reason: input.reason,
      method: eligibility.needsBankAccount ? 'MANUAL_TRANSFER' : 'CREDIT_REVERSE',
      bankCode: input.bankCode ?? null,
      bankAccountNo: input.bankAccountNo ?? null,
      accountName: input.accountName ?? null,
    },
  })

  return { ok: true, refundId: refund.id }
}

function refundRejectionMessage(reasonKey: RefundEligibility['reasonKey']): string {
  switch (reasonKey) {
    case 'notPaid':
      return '這張訂單還沒有收到款項，沒有東西可以退（未付款的訂單請直接取消）'
    case 'alreadyRequested':
      return '這張訂單已經有一筆退款單正在處理'
    case 'windowClosed':
      return '已超過可退款的期限；確定要處理請勾選「不受期限限制」'
    case 'cancelled':
      return '訂單已取消，沒有款項需要退還'
    case 'refunded':
      return '這張訂單已經退款完成'
    default:
      return '目前無法建立退款單'
  }
}

// ---------------------------------------------------------------------------
// 審核與實際退錢
// ---------------------------------------------------------------------------

export type RefundActionResult = { ok: true; message: string } | { ok: false; error: string }

/**
 * 同意退款。
 *
 * 信用卡會立刻呼叫綠界退刷；其他付款方式只能標記為「待人工匯款」，
 * 由客服匯完款後再按完成。
 */
export async function approveRefund(
  refundId: string,
  adminId: string,
): Promise<RefundActionResult> {
  const refund = await db.refundRequest.findUniqueOrThrow({
    where: { id: refundId },
    include: { payment: true, order: { select: { id: true, orderNo: true } } },
  })

  if (refund.status !== 'REQUESTED' && refund.status !== 'FAILED') {
    return { ok: false, error: '這筆申請已經處理過了' }
  }

  const payment = refund.payment
  const canReverse =
    payment !== null &&
    payment.provider === 'ECPAY' &&
    payment.status === 'PAID' &&
    Boolean(payment.tradeNo) &&
    isCreditCardPayment(payment.choosePayment, payment.paymentType)

  if (!canReverse) {
    await db.refundRequest.update({
      where: { id: refundId },
      data: {
        status: 'APPROVED',
        method: 'MANUAL_TRANSFER',
        reviewedById: adminId,
        reviewedAt: new Date(),
      },
    })
    await enqueue('send-email', {
      template: 'refund-approved',
      orderId: refund.orderId,
      refundId,
    })
    return {
      ok: true,
      message: '已同意退款。這筆不能線上退刷（非信用卡付款），請人工匯款後回來按「已完成匯款」。',
    }
  }

  const result = await refundCreditCard({
    merchantTradeNo: payment.merchantTradeNo,
    tradeNo: payment.tradeNo!,
    amount: refund.amount,
  })

  if (!result.ok) {
    await db.refundRequest.update({
      where: { id: refundId },
      data: {
        status: 'FAILED',
        method: 'CREDIT_REVERSE',
        reviewedById: adminId,
        reviewedAt: new Date(),
        failReason: result.error.slice(0, 500),
        rawResponse: { body: result.raw },
      },
    })
    return { ok: false, error: `綠界退刷失敗：${result.error}` }
  }

  await finalizeRefund(refundId, adminId, {
    method: 'CREDIT_REVERSE',
    raw: { body: result.raw },
  })
  return { ok: true, message: '已向綠界送出退刷，訂單標記為已退款' }
}

export async function rejectRefund(
  refundId: string,
  adminId: string,
  note: string,
): Promise<RefundActionResult> {
  const refund = await db.refundRequest.findUniqueOrThrow({ where: { id: refundId } })
  if (refund.status === 'COMPLETED') {
    return { ok: false, error: '已經退款完成的申請不能改成拒絕' }
  }

  await db.refundRequest.update({
    where: { id: refundId },
    data: {
      status: 'REJECTED',
      adminNote: note,
      reviewedById: adminId,
      reviewedAt: new Date(),
    },
  })
  await enqueue('send-email', {
    template: 'refund-rejected',
    orderId: refund.orderId,
    refundId,
  })
  return { ok: true, message: '已標記為不受理，並通知消費者' }
}

/** 人工匯款完成。信用卡退刷成功時由 approveRefund 直接走到這裡。 */
export async function completeManualRefund(
  refundId: string,
  adminId: string,
  note?: string,
): Promise<RefundActionResult> {
  const refund = await db.refundRequest.findUniqueOrThrow({ where: { id: refundId } })
  if (refund.status === 'COMPLETED') return { ok: false, error: '這筆已經完成了' }
  if (refund.status === 'REJECTED') return { ok: false, error: '已拒絕的申請不能標記完成' }

  await finalizeRefund(refundId, adminId, { method: 'MANUAL_TRANSFER', note })
  return { ok: true, message: '已標記退款完成，訂單狀態改為已退款' }
}

/**
 * 收尾：退款單完成、付款紀錄與訂單一起標成已退款。
 *
 * 刻意不自動把庫存加回去 —— 退款的原因可能是商品有瑕疵、也可能是消費者
 * 根本沒去取貨（貨還在路上或已退回倉庫）。要不要回架由人清點後在商品頁改，
 * 系統自己加回去會讓帳面庫存變成假的。
 */
async function finalizeRefund(
  refundId: string,
  adminId: string,
  options: { method: 'CREDIT_REVERSE' | 'MANUAL_TRANSFER'; note?: string; raw?: object },
): Promise<void> {
  const refund = await db.refundRequest.findUniqueOrThrow({ where: { id: refundId } })
  const now = new Date()

  await db.$transaction(async (tx) => {
    await tx.refundRequest.update({
      where: { id: refundId },
      data: {
        status: 'COMPLETED',
        method: options.method,
        reviewedById: adminId,
        reviewedAt: refund.reviewedAt ?? now,
        completedAt: now,
        adminNote: options.note ?? refund.adminNote,
        rawResponse: options.raw ? (options.raw as never) : refund.rawResponse ?? undefined,
        failReason: null,
      },
    })

    if (refund.paymentId) {
      await tx.payment.update({
        where: { id: refund.paymentId },
        data: { status: 'REFUNDED' },
      })
    }

    await tx.order.update({
      where: { id: refund.orderId },
      data: { status: 'REFUNDED' },
    })
  })

  await enqueue('send-email', {
    template: 'refund-completed',
    orderId: refund.orderId,
    refundId,
  })
}
