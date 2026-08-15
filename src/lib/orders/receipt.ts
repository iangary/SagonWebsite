import 'server-only'
import { db } from '@/lib/db'
import { invalidReceipt, issueReceipt } from '@/lib/ecpay/receipt'

/**
 * 為已付款的訂單開立綠界電子收據。由 worker 呼叫，失敗會自動重試。
 *
 * ⚠️ 電子收據不是統一發票 —— 紙本發票另由人工開立、隨包裹寄出，見 Invoice model。
 *
 * RelateNumber 不可重複，重複開立綠界會退回，所以先擋掉已開過的。
 */
export async function issueReceiptForOrder(orderId: string): Promise<void> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { receipt: true, items: true },
  })

  if (!order?.receipt) throw new Error(`訂單沒有收據資料：${orderId}`)
  if (order.receipt.receiptNo) return // 已開立
  if (order.status === 'CANCELLED') return

  // 綠界要求 Amount 與 Items 加總一致，所以運費與折扣也要各做成一個品項，
  // 否則會被退件。
  //
  // 注意：折扣是負數單價。官方文件只寫「單價可為 0」，沒有明說可為負，
  // 測試站要實際驗過再上線；若被退件就改成把折扣按比例攤回各品項。
  const items = order.items.map((item) => ({
    name: item.productName,
    count: item.qty,
    price: item.unitPrice,
  }))

  if (order.shippingFee > 0) {
    items.push({ name: '運費', count: 1, price: order.shippingFee })
  }
  if (order.discountTotal > 0) {
    items.push({ name: '折扣', count: 1, price: -order.discountTotal })
  }

  try {
    const result = await issueReceipt({
      relateNumber: order.orderNo,
      name: order.recipientName,
      email: order.email,
      phone: order.phone,
      items,
      amount: order.grandTotal,
    })

    if (result.RtnCode !== 1) {
      await db.receipt.update({
        where: { id: order.receipt.id },
        data: {
          status: 'FAILED',
          failReason: `${result.RtnCode}: ${result.RtnMsg}`.slice(0, 500),
          rawResponse: result as unknown as object,
        },
      })
      throw new Error(`開立收據失敗：${result.RtnMsg}`)
    }

    await db.receipt.update({
      where: { id: order.receipt.id },
      data: {
        receiptNo: result.ReceiptNo ?? null,
        issuedAt: new Date(),
        status: 'ISSUED',
        failReason: null,
        rawResponse: result as unknown as object,
      },
    })
  } catch (error) {
    await db.receipt.update({
      where: { id: order.receipt.id },
      data: {
        status: 'FAILED',
        failReason: (error as Error).message.slice(0, 500),
      },
    })
    throw error
  }
}

/** 退款時作廢收據。 */
export async function voidReceiptForOrder(orderId: string, reason: string): Promise<void> {
  const receipt = await db.receipt.findUnique({ where: { orderId } })
  if (!receipt?.receiptNo) throw new Error('這張訂單沒有已開立的收據')
  if (receipt.status === 'VOIDED') return

  const result = await invalidReceipt(receipt.receiptNo, reason)

  if (result.RtnCode !== 1) {
    throw new Error(`作廢收據失敗：${result.RtnMsg}`)
  }

  await db.receipt.update({
    where: { id: receipt.id },
    data: {
      status: 'VOIDED',
      voidedAt: new Date(),
      voidReason: reason.slice(0, 200),
      rawResponse: result as unknown as object,
    },
  })
}
