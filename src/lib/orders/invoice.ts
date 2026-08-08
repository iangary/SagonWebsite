import 'server-only'
import { db } from '@/lib/db'
import { issueInvoice, voidInvoice } from '@/lib/ecpay/invoice'
import { parseEcpayDate } from './payment'

/** 綠界載具代碼：1=綠界會員、2=自然人憑證、3=手機條碼 */
const CARRIER_CODE = {
  NONE: '' as const,
  MEMBER: '1' as const,
  CITIZEN: '2' as const,
  MOBILE: '3' as const,
}

/**
 * 為已付款的訂單開立電子發票。由 worker 呼叫。
 *
 * 發票只能開一次，重複開立綠界會回錯誤，所以先擋掉已開過的。
 */
export async function issueInvoiceForOrder(orderId: string): Promise<void> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { invoice: true, items: true },
  })

  if (!order?.invoice) throw new Error(`訂單沒有發票資料：${orderId}`)
  if (order.invoice.invoiceNumber) return // 已開立
  if (order.status === 'CANCELLED') return

  // 綠界的發票金額必須等於明細加總，所以把折扣與運費也做成品項，
  // 否則會被退件（SalesAmount 與 Items 對不起來）。
  const items = order.items.map((item) => ({
    name: item.productName,
    count: item.qty,
    word: '件',
    price: item.unitPrice,
  }))

  if (order.shippingFee > 0) {
    items.push({ name: '運費', count: 1, word: '式', price: order.shippingFee })
  }
  if (order.discountTotal > 0) {
    items.push({ name: '折扣', count: 1, word: '式', price: -order.discountTotal })
  }

  try {
    const result = await issueInvoice({
      relateNumber: order.orderNo,
      customerName: order.recipientName,
      customerEmail: order.email,
      customerPhone: order.phone,
      taxId: order.invoice.taxId ?? undefined,
      companyName: order.invoice.companyName ?? undefined,
      carrierType: CARRIER_CODE[order.invoice.carrierType],
      carrierNum: order.invoice.carrierNum ?? undefined,
      donate: order.invoice.donation,
      loveCode: order.invoice.loveCode ?? undefined,
      items,
      totalAmount: order.grandTotal,
    })

    if (result.RtnCode !== 1) {
      await db.invoice.update({
        where: { id: order.invoice.id },
        data: {
          status: 'FAILED',
          failReason: `${result.RtnCode}: ${result.RtnMsg}`.slice(0, 500),
          rawResponse: result as unknown as object,
        },
      })
      throw new Error(`開立發票失敗：${result.RtnMsg}`)
    }

    await db.invoice.update({
      where: { id: order.invoice.id },
      data: {
        invoiceNumber: result.InvoiceNo ?? null,
        randomNumber: result.RandomNumber ?? null,
        invoiceDate: parseEcpayDate(result.InvoiceDate) ?? new Date(),
        status: 'ISSUED',
        failReason: null,
        rawResponse: result as unknown as object,
      },
    })
  } catch (error) {
    await db.invoice.update({
      where: { id: order.invoice.id },
      data: {
        status: 'FAILED',
        failReason: (error as Error).message.slice(0, 500),
      },
    })
    throw error
  }
}

/** 退款時作廢發票。 */
export async function voidInvoiceForOrder(orderId: string, reason: string): Promise<void> {
  const invoice = await db.invoice.findUnique({ where: { orderId } })
  if (!invoice?.invoiceNumber) throw new Error('這張訂單沒有已開立的發票')
  if (invoice.status === 'VOIDED') return

  const result = await voidInvoice(invoice.invoiceNumber, reason)

  if (result.RtnCode !== 1) {
    throw new Error(`作廢發票失敗：${result.RtnMsg}`)
  }

  await db.invoice.update({
    where: { id: invoice.id },
    data: {
      status: 'VOIDED',
      voidedAt: new Date(),
      voidReason: reason.slice(0, 200),
      rawResponse: result as unknown as object,
    },
  })
}
