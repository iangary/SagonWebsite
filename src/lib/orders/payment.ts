import 'server-only'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { enqueue } from '@/lib/queue'
import { commitOrderReservations } from './stock'
import { isPaymentSuccessful, isSimulatedPayment } from '@/lib/ecpay/aio'

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

  // 已經處理過就直接結束（綠界會重送）。
  // 但「訂單已取消、錢卻進來了」不能無聲吞掉 —— 這代表消費者在訂單被
  // 逾期取消後才完成付款（例如 ATM 排程與綠界期限的邊界時刻），錢已經
  // 收到但不會出貨，必須留下需要人工退款的紀錄。
  if (payment.order.status !== 'PENDING_PAYMENT') {
    if (payment.order.status === 'CANCELLED' && payment.status !== 'PAID') {
      await db.payment.update({
        where: { id: payment.id },
        data: {
          status: 'PAID',
          tradeNo: params.TradeNo ?? null,
          paymentType: params.PaymentType ?? null,
          paidAt: parseEcpayDate(params.PaymentDate) ?? new Date(),
          failReason: '逾期入帳：訂單已取消但仍收到付款，需人工退款',
          rawCallback: params,
        },
      })
    }
    return
  }

  await db.$transaction(async (tx) => {
    // 交易內再讀一次，擋住兩個通知同時進來的競態
    const fresh = await tx.order.findUnique({
      where: { id: payment.orderId },
      select: { status: true },
    })
    if (fresh?.status !== 'PENDING_PAYMENT') return

    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'PAID',
        tradeNo: params.TradeNo ?? null,
        paymentType: params.PaymentType ?? null,
        paidAt: parseEcpayDate(params.PaymentDate) ?? new Date(),
        rawCallback: params,
      },
    })

    await tx.order.update({
      where: { id: payment.orderId },
      data: { status: 'PAID', paidAt: new Date() },
    })

    // 預扣轉實扣
    await commitOrderReservations(tx, payment.orderId)
  })

  // 後續動作全部非同步，不讓綠界等
  await enqueue('create-shipment', { orderId: payment.orderId })
  if (env.ECPAY_RECEIPT_AUTO_ISSUE) {
    await enqueue('issue-receipt', { orderId: payment.orderId })
  }
  await enqueue('send-email', { template: 'order-confirmed', orderId: payment.orderId })
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

  await db.payment.update({
    where: { id: payment.id },
    data: {
      status: 'AWAITING_TRANSFER',
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

  await enqueue('send-email', { template: 'payment-info', orderId: payment.orderId })
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
