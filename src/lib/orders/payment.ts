import 'server-only'
import type { Payment, Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { enqueue } from '@/lib/queue'
import { commitOrderReservations } from './stock'
import {
  isPaymentSuccessful,
  isSimulatedPayment,
  queryTradeInfo,
  TRADE_STATUS,
} from '@/lib/ecpay/aio'

/**
 * 一張訂單目前生效的那筆付款。
 *
 * payments 是一對多 —— 消費者在待付款期間改用其他付款方式時會多出一筆，
 * 舊的那筆標記 supersededAt 但不能刪（綠界的回拋只帶 MerchantTradeNo，
 * 舊的超商代碼真的被繳費時要找得回是哪張訂單）。
 */
export function currentPaymentOf<T extends { supersededAt: Date | null; createdAt: Date }>(
  payments: T[],
): T | null {
  const live = payments.filter((p) => !p.supersededAt)
  const pool = live.length > 0 ? live : payments
  return (
    pool.slice().sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
  )
}

/** Prisma 的 include：訂單頁一律用這組，才不會有的地方拿新的、有的地方拿舊的。 */
export const currentPaymentInclude = {
  orderBy: { createdAt: 'desc' },
} satisfies Prisma.Order$paymentsArgs

export async function findCurrentPayment(orderId: string): Promise<Payment | null> {
  return db.payment.findFirst({
    where: { orderId, supersededAt: null },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * 處理綠界的付款結果通知（ReturnURL）。
 *
 * 這是判定訂單是否付款成功的唯一權威來源 —— 前台導回的 OrderResultURL
 * 是使用者的瀏覽器送來的，可以偽造，只能拿來顯示畫面。
 */
export async function handlePaymentReturn(params: Record<string, string>): Promise<void> {
  const merchantTradeNo = params.MerchantTradeNo
  if (!merchantTradeNo) throw new Error('回拋缺少 MerchantTradeNo')

  const payment = await db.payment.findUnique({
    where: { merchantTradeNo },
    include: { order: { select: { id: true, status: true, grandTotal: true } } },
  })
  if (!payment) throw new Error(`找不到對應的付款紀錄：${merchantTradeNo}`)

  if (!isPaymentSuccessful(params)) {
    // 已經收到過款的紀錄不要被後到的失敗通知蓋掉
    if (payment.status === 'PAID') return
    await db.payment.update({
      where: { id: payment.id },
      data: {
        status: 'FAILED',
        failReason: `${params.RtnCode}: ${params.RtnMsg ?? ''}`.slice(0, 500),
        rawCallback: params,
      },
    })
    return
  }

  // 正式環境收到模擬付款一律當作未付款，否則有人能用測試工具騙到出貨
  if (env.ECPAY_ENV === 'production' && isSimulatedPayment(params)) {
    await db.payment.update({
      where: { id: payment.id },
      data: {
        status: 'FAILED',
        failReason: '正式環境收到模擬付款通知（SimulatePaid=1），已拒絕',
        rawCallback: params,
      },
    })
    throw new Error(`正式環境收到模擬付款通知：${merchantTradeNo}`)
  }

  // 金額必須與我們記錄的一致，避免被竄改後低價成交
  const paidAmount = Number.parseInt(params.TradeAmt ?? '0', 10)
  if (paidAmount !== payment.amount) {
    await db.payment.update({
      where: { id: payment.id },
      data: {
        status: 'FAILED',
        failReason: `金額不符：綠界回報 ${paidAmount}，訂單應為 ${payment.amount}`,
        rawCallback: params,
      },
    })
    throw new Error(`付款金額不符：${merchantTradeNo}`)
  }

  await applySuccessfulPayment({
    paymentId: payment.id,
    orderId: payment.orderId,
    orderStatus: payment.order.status,
    alreadyPaid: payment.status === 'PAID',
    superseded: Boolean(payment.supersededAt),
    tradeNo: params.TradeNo ?? null,
    paymentType: params.PaymentType ?? null,
    paidAt: parseEcpayDate(params.PaymentDate) ?? new Date(),
    raw: params,
  })
}

interface SuccessfulPayment {
  paymentId: string
  orderId: string
  orderStatus: string
  alreadyPaid: boolean
  /** 這筆是不是已經被「改用其他付款方式」作廢掉的舊代碼 */
  superseded: boolean
  tradeNo: string | null
  paymentType: string | null
  paidAt: Date
  raw: Record<string, string>
}

/**
 * 把「綠界說這筆收到錢了」落到資料庫。
 *
 * 回拋（ReturnURL）與主動對帳（QueryTradeInfo）都走這一支，兩條路的規則
 * 必須一模一樣，否則會出現「排程補的單沒扣庫存」這種只在特定路徑發生的 bug。
 *
 * 三種收到錢的情境：
 *   1. 訂單還在待付款 → 正常入帳，其他還沒繳的代碼一併作廢
 *   2. 訂單已取消     → 逾期入帳，錢收了但不會出貨 → 開退款單
 *   3. 訂單已付款     → 重複付款（多半是改了付款方式後又去繳舊代碼）→ 開退款單
 */
async function applySuccessfulPayment(input: SuccessfulPayment): Promise<void> {
  if (input.alreadyPaid) return // 綠界會重送，冪等處理

  // 情境 2 / 3：錢進來了但這張訂單不會（或已經）出貨，必須留下需要退款的紀錄，
  // 不能無聲吞掉。最常見的是消費者改用其他付款方式後又拿舊的超商代碼去繳費 ——
  // 綠界沒有作廢超商代碼的 API，舊代碼在期限內一直有效。
  if (input.orderStatus !== 'PENDING_PAYMENT') {
    const duplicated = input.orderStatus !== 'CANCELLED'
    const reason = duplicated
      ? '重複付款：訂單已付款或已出貨，這筆是另一組代碼／帳號進來的款項，需人工退款'
      : '逾期入帳：訂單已取消但仍收到付款，需人工退款'

    await db.payment.update({
      where: { id: input.paymentId },
      data: {
        status: 'PAID',
        tradeNo: input.tradeNo,
        paymentType: input.paymentType,
        paidAt: input.paidAt,
        failReason: reason,
        rawCallback: input.raw,
        syncedAt: new Date(),
      },
    })

    await openSystemRefundRequest(input.orderId, input.paymentId, reason)
    return
  }

  await db.$transaction(async (tx) => {
    // 交易內再讀一次，擋住兩個通知同時進來的競態
    const fresh = await tx.order.findUnique({
      where: { id: input.orderId },
      select: { status: true },
    })
    if (fresh?.status !== 'PENDING_PAYMENT') return

    await tx.payment.update({
      where: { id: input.paymentId },
      data: {
        status: 'PAID',
        tradeNo: input.tradeNo,
        paymentType: input.paymentType,
        paidAt: input.paidAt,
        rawCallback: input.raw,
        syncedAt: new Date(),
        // 舊代碼被繳費也算付款成功，把它從「已作廢」拉回生效狀態，
        // 否則訂單頁會顯示另一組沒人繳的代碼
        supersededAt: null,
      },
    })

    // 同一張訂單其他還沒繳的代碼／帳號一律作廢，避免消費者繳第二次
    await tx.payment.updateMany({
      where: {
        orderId: input.orderId,
        id: { not: input.paymentId },
        status: { in: ['PENDING', 'AWAITING_TRANSFER'] },
      },
      data: { status: 'EXPIRED', supersededAt: new Date() },
    })

    await tx.order.update({
      where: { id: input.orderId },
      data: { status: 'PAID', paidAt: new Date() },
    })

    // 預扣轉實扣
    await commitOrderReservations(tx, input.orderId)
  })

  // 後續動作全部非同步，不讓綠界等
  await enqueue('create-shipment', { orderId: input.orderId })
  if (env.ECPAY_RECEIPT_AUTO_ISSUE) {
    await enqueue('issue-receipt', { orderId: input.orderId })
  }
  await enqueue('send-email', { template: 'order-confirmed', orderId: input.orderId })
}

/**
 * 匯款到公司帳戶：後台確認錢進來了。
 *
 * 這個付款方式沒有金流商，也就沒有回拋與對帳 API —— 唯一的入帳來源就是有人
 * 去看銀行帳戶。所以這支是**人按的**，而且是這種訂單唯一的付款成立路徑。
 *
 * 後續動作（庫存實扣、建物流單、開收據、寄確認信）與綠界付款成功完全一樣，
 * 刻意走同一支 applySuccessfulPayment，避免「人工入帳的單沒扣庫存」這種
 * 只在特定路徑發生的 bug。連「錢進來得太晚」也一併沿用：訂單已被逾期排程
 * 取消時它會自動開一張退款單，而不是把已取消的訂單偷偷復活。
 *
 * @returns false = 這張訂單沒有等待匯款的紀錄（已收過款、或不是匯款訂單）
 */
export async function markBankTransferPaid(input: {
  orderId: string
  /** 對帳資訊，例如「帳號末五碼 12345、8/23 入帳」。會存進 payment 供日後查。 */
  note?: string
}): Promise<boolean> {
  const payment = await db.payment.findFirst({
    where: { orderId: input.orderId, provider: 'BANK', supersededAt: null },
    orderBy: { createdAt: 'desc' },
    include: { order: { select: { status: true } } },
  })
  if (!payment || payment.status === 'PAID') return false

  await applySuccessfulPayment({
    paymentId: payment.id,
    orderId: input.orderId,
    orderStatus: payment.order.status,
    alreadyPaid: false,
    superseded: false,
    // 沒有金流商，沒有交易編號可記
    tradeNo: null,
    paymentType: 'BankTransfer',
    paidAt: new Date(),
    raw: { source: 'admin-manual', note: input.note ?? '' },
  })
  return true
}

/**
 * 系統自己發現「收了不該收的錢」時開一張退款單，讓它出現在後台的退款佇列。
 * 只開一次 —— 綠界重送通知不該產生第二張。
 */
async function openSystemRefundRequest(
  orderId: string,
  paymentId: string,
  reason: string,
): Promise<void> {
  const existing = await db.refundRequest.findFirst({
    where: { orderId, paymentId, status: { in: ['REQUESTED', 'APPROVED'] } },
  })
  if (existing) return

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { grandTotal: true, userId: true },
  })
  if (!order) return

  const refund = await db.refundRequest.create({
    data: {
      orderId,
      paymentId,
      userId: order.userId,
      amount: order.grandTotal,
      reason: `【系統偵測】${reason}`,
    },
  })

  // 這種單不是客人申請的，客服不會主動去看退款頁，一定要推一封信出去
  await enqueue('send-email', {
    template: 'refund-requested',
    orderId,
    refundId: refund.id,
  })
}

/**
 * 處理 ATM / CVS 取號通知（PaymentInfoURL）。
 * 這時候還沒收到錢，只是拿到虛擬帳號或繳費代碼，要存起來並通知消費者去繳費。
 */
export async function handlePaymentInfo(params: Record<string, string>): Promise<void> {
  const merchantTradeNo = params.MerchantTradeNo
  if (!merchantTradeNo) throw new Error('回拋缺少 MerchantTradeNo')

  const payment = await db.payment.findUnique({ where: { merchantTradeNo } })
  if (!payment) throw new Error(`找不到對應的付款紀錄：${merchantTradeNo}`)

  // 已經作廢（消費者改用其他方式）就只留紀錄，不要把狀態拉回等待付款，
  // 否則訂單頁會同時出現兩組有效的繳費資訊。
  const superseded = Boolean(payment.supersededAt)

  await db.payment.update({
    where: { id: payment.id },
    data: {
      status: superseded ? payment.status : 'AWAITING_TRANSFER',
      paymentType: params.PaymentType ?? null,
      bankCode: params.BankCode ?? null,
      vAccount: params.vAccount ?? null,
      paymentNo: params.PaymentNo ?? null,
      barcode1: params.Barcode1 ?? null,
      barcode2: params.Barcode2 ?? null,
      barcode3: params.Barcode3 ?? null,
      expireDate: params.ExpireDate ?? null,
      rawCallback: params,
    },
  })

  if (superseded) return

  await enqueue('send-email', { template: 'payment-info', orderId: payment.orderId })
}

/**
 * 主動向綠界查詢一筆付款的真實狀態（QueryTradeInfo），並把結果套用到訂單。
 *
 * 存在的理由：ReturnURL 是「綠界打得到我們」才會成立的機制。CDN、憑證、
 * 主機重啟都可能讓那通通知永久遺失，訂單就會卡在待付款、消費者卻已經繳了錢。
 * 後台的「向綠界查詢」按鈕與對帳排程都走這一支。
 */
export async function syncPaymentWithEcpay(paymentId: string): Promise<{
  tradeStatus: string
  paid: boolean
  changed: boolean
}> {
  const payment = await db.payment.findUniqueOrThrow({
    where: { id: paymentId },
    include: { order: { select: { id: true, status: true } } },
  })

  if (payment.provider !== 'ECPAY') {
    throw new Error('這張訂單不是綠界金流（貨到付款／匯款），查不到交易')
  }

  const info = await queryTradeInfo(payment.merchantTradeNo)
  const tradeStatus = info.TradeStatus ?? ''
  const now = new Date()

  if (tradeStatus === TRADE_STATUS.paid) {
    const amount = Number.parseInt(info.TradeAmt ?? '0', 10)
    if (amount !== payment.amount) {
      await db.payment.update({
        where: { id: payment.id },
        data: {
          failReason: `對帳金額不符：綠界 ${amount}，我們記 ${payment.amount}`,
          syncedAt: now,
        },
      })
      throw new Error(`對帳金額不符：${payment.merchantTradeNo}`)
    }

    const wasPaid = payment.status === 'PAID'
    await applySuccessfulPayment({
      paymentId: payment.id,
      orderId: payment.orderId,
      orderStatus: payment.order.status,
      alreadyPaid: wasPaid,
      superseded: Boolean(payment.supersededAt),
      tradeNo: info.TradeNo ?? null,
      paymentType: info.PaymentType ?? null,
      paidAt: parseEcpayDate(info.PaymentDate) ?? now,
      raw: info,
    })
    return { tradeStatus, paid: true, changed: !wasPaid }
  }

  if (tradeStatus === TRADE_STATUS.failed) {
    const changed = payment.status !== 'FAILED'
    await db.payment.update({
      where: { id: payment.id },
      data: {
        status: payment.status === 'PAID' ? 'PAID' : 'FAILED',
        failReason: `綠界對帳：交易失敗（${tradeStatus}）`,
        syncedAt: now,
      },
    })
    return { tradeStatus, paid: false, changed }
  }

  // 未付款（0）或綠界查不到這筆：只更新查詢時間，不要動狀態
  await db.payment.update({ where: { id: payment.id }, data: { syncedAt: now } })
  return { tradeStatus, paid: false, changed: false }
}

/**
 * 對帳排程：把「還在等付款、很久沒查」的單拿去問綠界。
 *
 * 綠界對 API 有限速（太快會回 403），所以一次只查少量、且同一筆至少隔
 * SYNC_COOLDOWN_MINUTES 才會再查一次。
 */
const SYNC_BATCH = 20
const SYNC_COOLDOWN_MINUTES = 30

export async function reconcilePendingPayments(): Promise<{
  checked: number
  paid: number
}> {
  const cooldown = new Date(Date.now() - SYNC_COOLDOWN_MINUTES * 60 * 1000)

  const candidates = await db.payment.findMany({
    where: {
      provider: 'ECPAY',
      supersededAt: null,
      status: { in: ['PENDING', 'AWAITING_TRANSFER'] },
      order: { status: 'PENDING_PAYMENT' },
      OR: [{ syncedAt: null }, { syncedAt: { lt: cooldown } }],
      // 剛建立的單還沒付款是正常的，先別去吵綠界
      createdAt: { lt: new Date(Date.now() - 10 * 60 * 1000) },
    },
    orderBy: { syncedAt: { sort: 'asc', nulls: 'first' } },
    take: SYNC_BATCH,
    select: { id: true, merchantTradeNo: true },
  })

  let paid = 0
  for (const candidate of candidates) {
    try {
      const result = await syncPaymentWithEcpay(candidate.id)
      if (result.paid && result.changed) {
        paid++
        console.info(`[reconcile] 補回漏收的付款通知：${candidate.merchantTradeNo}`)
      }
    } catch (error) {
      console.error(`[reconcile] 查詢 ${candidate.merchantTradeNo} 失敗`, error)
    }
  }

  return { checked: candidates.length, paid }
}

/** 綠界的日期格式是 yyyy/MM/dd HH:mm:ss（台北時間），沒有時區標記 */
export function parseEcpayDate(raw: string | undefined): Date | null {
  if (!raw) return null
  const m = raw.match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/)
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m
  // 明確標成 +08:00，否則會被當成伺服器本地時間
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}+08:00`)
}
