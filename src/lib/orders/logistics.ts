import 'server-only'
import { db } from '@/lib/db'
import { enqueue } from '@/lib/queue'
import { createShipment, mapLogisticsStatus } from '@/lib/ecpay/logistics'
import { parseEcpayDate } from './payment'

/**
 * 付款成功後建立綠界物流訂單。由 worker 呼叫，失敗會自動重試。
 */
export async function createShipmentForOrder(orderId: string): Promise<void> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { shipment: true, items: true },
  })

  if (!order?.shipment) throw new Error(`訂單沒有物流資料：${orderId}`)

  // 已經建過就不要再建一次（重試或重複派工）
  if (order.shipment.allPayLogisticsId) return

  if (order.status === 'CANCELLED' || order.status === 'REFUNDED') return

  const goodsName =
    order.items.length === 1
      ? order.items[0]!.productName
      : `${order.items[0]!.productName} 等 ${order.items.length} 項`

  const result = await createShipment({
    // 物流訂單編號不能與金流的 MerchantTradeNo 相同，加後綴區分
    merchantTradeNo: `${order.orderNo}L`.slice(0, 20),
    subType: order.shipment.logisticsSubType,
    goodsAmount: order.grandTotal,
    goodsName,
    receiverName: order.shipment.receiverName,
    receiverCellphone: order.shipment.receiverCell,
    receiverEmail: order.email,
    receiverStoreId: order.shipment.cvsStoreId ?? undefined,
    receiverZipCode: order.shipment.receiverZip ?? undefined,
    receiverAddress: order.shipment.receiverAddress ?? undefined,
  })

  if (!result.ok) {
    await db.shipment.update({
      where: { id: order.shipment.id },
      data: {
        status: 'FAILED',
        failReason: result.error?.slice(0, 500) ?? '未知錯誤',
        rawResponse: result.raw,
      },
    })
    // 丟出去讓 BullMQ 重試；連續失敗會留在 failed 佇列由後台處理
    throw new Error(`建立物流訂單失敗：${result.error}`)
  }

  await db.$transaction([
    db.shipment.update({
      where: { id: order.shipment.id },
      data: {
        allPayLogisticsId: result.allPayLogisticsId ?? null,
        shipmentNo: result.shipmentNo ?? null,
        cvsValidationNo: result.cvsValidationNo ?? null,
        status: 'CREATED',
        failReason: null,
        rawResponse: result.raw,
      },
    }),
    db.order.update({
      where: { id: order.id },
      // 已付款 → 備貨中
      data: { status: order.status === 'PAID' ? 'PROCESSING' : order.status },
    }),
  ])
}

/**
 * 處理綠界的物流狀態回拋。
 * 每一次回拋都寫一筆 log，並把對應得到的狀態同步到 Shipment 與 Order。
 */
export async function handleLogisticsReply(params: Record<string, string>): Promise<void> {
  const allPayLogisticsId = params.AllPayLogisticsID
  const merchantTradeNo = params.MerchantTradeNo

  // 先用綠界物流編號找。
  let shipment = allPayLogisticsId
    ? await db.shipment.findFirst({ where: { allPayLogisticsId } })
    : null

  // 找不到時再用訂單編號回推 —— 綠界很常在 Create 的 HTTP 回應還沒寫進 DB 之前
  // 就先送出第一筆狀態回拋，這時我們這端還不知道 AllPayLogisticsID。
  // 物流訂單編號是「金流編號 + L」。
  if (!shipment && merchantTradeNo) {
    shipment = await db.shipment.findFirst({
      where: { order: { orderNo: merchantTradeNo.replace(/L$/, '') } },
    })
  }

  if (!shipment) {
    throw new Error(`找不到對應的物流單：${allPayLogisticsId ?? merchantTradeNo ?? '(無識別碼)'}`)
  }

  const statusCode = params.RtnCode ?? ''
  const message = params.RtnMsg ?? ''

  await db.logisticsStatusLog.create({
    data: {
      shipmentId: shipment.id,
      statusCode,
      message,
      occurredAt: parseEcpayDate(params.UpdateStatusDate) ?? new Date(),
      raw: params,
    },
  })

  const mapped = mapLogisticsStatus(statusCode)

  await db.shipment.update({
    where: { id: shipment.id },
    data: {
      statusCode,
      statusMsg: message.slice(0, 500),
      ...(mapped ? { status: mapped } : {}),
      // 回拋比 Create 的回應早到時，這裡順便把物流編號補起來
      ...(allPayLogisticsId && !shipment.allPayLogisticsId ? { allPayLogisticsId } : {}),
      // 首次回拋時可能才拿到單號
      ...(params.CVSPaymentNo && !shipment.shipmentNo ? { shipmentNo: params.CVSPaymentNo } : {}),
      ...(params.BookingNote && !shipment.shipmentNo ? { shipmentNo: params.BookingNote } : {}),
    },
  })

  if (!mapped) return

  // 物流狀態帶動訂單狀態
  const orderStatus =
    mapped === 'PICKED_UP'
      ? 'COMPLETED'
      : mapped === 'IN_TRANSIT' || mapped === 'ARRIVED'
        ? 'SHIPPED'
        : null

  if (orderStatus) {
    const order = await db.order.findUnique({
      where: { id: shipment.orderId },
      select: { status: true },
    })

    // 已完成的訂單不要被較早的狀態往回推
    const isRegression = order?.status === 'COMPLETED' && orderStatus === 'SHIPPED'
    if (order && !isRegression && order.status !== orderStatus) {
      await db.order.update({ where: { id: shipment.orderId }, data: { status: orderStatus } })
      if (orderStatus === 'SHIPPED') {
        await enqueue('send-email', { template: 'shipped', orderId: shipment.orderId })
      }
    }
  }
}
