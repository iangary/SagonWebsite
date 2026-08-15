import 'server-only'
import {
  Prisma,
  type Order,
  type OrderItem,
  type Shipment,
  type ShipmentStatus,
  type ShippingMethod,
} from '@prisma/client'
import { db } from '@/lib/db'
import { enqueue } from '@/lib/queue'
import {
  createShipment,
  isC2C,
  mapLogisticsStatus,
  GOODS_AMOUNT_MAX,
  GOODS_AMOUNT_MIN,
} from '@/lib/ecpay/logistics'
import { senderConfig } from '@/lib/ecpay/config'
import { downloadObt, parsingAddress, printObt } from '@/lib/tcat/client'
import { tcatConfig } from '@/lib/tcat/config'
import { isDeliverable } from '@/lib/tcat/fields'
import { saveLabel } from '@/lib/tcat/labels'
import { buildTcatOrder, goodsNameFor, totalQuantityOf, TcatOrderInvalid } from '@/lib/tcat/order'
import { parseEcpayDate } from './payment'

/**
 * 出貨分兩條路：超商取貨走綠界，宅配走黑貓（我們自己簽約的，不經綠界）。
 *
 * 兩者的建單方式完全不同，所以抽一層 provider，呼叫端只認 shippingMethod。
 */

type OrderForShipment = Order & { shipment: Shipment; items: OrderItem[] }

/** 建單結果。manual 代表這條通路要人工處理，不會（或不該再）打外部 API。 */
export type ShipmentCreation =
  | {
      status: 'created'
      allPayLogisticsId?: string
      shipmentNo?: string
      cvsValidationNo?: string
      /** 黑貓才有：已下載的託運單 PDF */
      label?: { path: string; downloadedAt: Date }
      /** 建單成功但有需要人工留意的事（例如 PDF 沒抓到） */
      labelWarning?: string
      raw: unknown
    }
  | { status: 'manual'; note: string }

export interface ShippingProvider {
  readonly name: string
  create(order: OrderForShipment): Promise<ShipmentCreation>
}

export const ecpayCvsProvider: ShippingProvider = {
  name: '綠界超商取貨',

  async create(order) {
    const subType = order.shipment.logisticsSubType

    if (!isC2C(subType)) {
      throw new Error(`綠界只開通超商 C2C，不支援 ${subType}`)
    }
    if (!order.shipment.cvsStoreId) {
      throw new Error('超商取貨缺少門市代號，無法建單')
    }

    // 綠界的 GoodsAmount 只收 1~20,000。超出範圍送出去只會被退件並無限重試，
    // 不如直接轉人工處理。
    const amount = order.grandTotal
    if (amount < GOODS_AMOUNT_MIN || amount > GOODS_AMOUNT_MAX) {
      return {
        status: 'manual',
        note: `訂單金額 ${amount} 超出綠界超商取貨的 ${GOODS_AMOUNT_MIN}~${GOODS_AMOUNT_MAX} 元限制，需改用其他方式出貨`,
      }
    }

    const result = await createShipment({
      // 物流訂單編號不能與金流的 MerchantTradeNo 相同，加後綴區分
      merchantTradeNo: `${order.orderNo}L`.slice(0, 20),
      subType,
      goodsAmount: amount,
      goodsName: goodsNameFor(order.items),
      receiverName: order.shipment.receiverName,
      receiverCellphone: order.shipment.receiverCell,
      receiverEmail: order.email,
      receiverStoreId: order.shipment.cvsStoreId,
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

    return {
      status: 'created',
      allPayLogisticsId: result.allPayLogisticsId,
      shipmentNo: result.shipmentNo,
      cvsValidationNo: result.cvsValidationNo,
      raw: result.raw,
    }
  },
}

/**
 * 黑貓宅急便（統一速達印單 API）。
 *
 * 流程三步：
 *   1. ParsingAddress  查收件地址的黑貓郵碼（唯讀，可安全重試）
 *   2. PrintOBT        建單並配號 ←── 有副作用，成功即託運單成立
 *   3. DownloadOBT     抓託運單 PDF（FileNo 只有 24 小時）
 *
 * **第 2 步之後這支函式不再往外 throw**，因為 throw 會進 BullMQ 重試迴圈，
 * 而 PrintOBT 沒有冪等鍵 —— 重跑一次就是第二張真實託運單、第二筆運費。
 * 所以：
 *   - 第 2 步失敗 → 轉 manual，請人去黑貓後台確認到底建了沒（見 adminRecordTcatShipment）
 *   - 第 3 步失敗 → 狀態仍是 CREATED（單確實成立了），只把警告寫進 failReason
 */
export const tcatProvider: ShippingProvider = {
  name: '黑貓宅急便',

  async create(order) {
    const { shipment } = order

    if (!shipment.receiverAddress) {
      return { status: 'manual', note: '宅配訂單沒有收件地址，無法建單' }
    }

    // 1. 地址要先換得到黑貓郵碼，換不到就是黑貓送不到這個地址
    const postNumbers = await parsingAddress([shipment.receiverAddress])
    const postNumber = postNumbers.get(shipment.receiverAddress)

    if (!isDeliverable(postNumber)) {
      // 這種失敗重試幾次都一樣，不要 throw 進 BullMQ 重試迴圈
      return {
        status: 'manual',
        note: `黑貓查無此地址的配送郵碼，可能是地址有誤或不在配送範圍：${shipment.receiverAddress}`,
      }
    }

    let tcatOrder
    try {
      tcatOrder = buildTcatOrder(
        {
          orderNo: order.orderNo,
          recipientName: shipment.receiverName,
          recipientTel: shipment.receiverPhone,
          recipientMobile: shipment.receiverCell,
          recipientAddress: shipment.receiverAddress,
          senderZip: tcatConfig.senderZip,
          senderName: senderConfig.name,
          senderTel: senderConfig.phone,
          senderMobile: senderConfig.cellphone,
          senderAddress: senderConfig.address,
          productName: goodsNameFor(order.items),
          totalQuantity: totalQuantityOf(order.items),
        },
        {
          productTypeId: tcatConfig.productTypeId,
          defaultSpec: tcatConfig.defaultSpec,
          specQtyStep: tcatConfig.specQtyStep,
        },
      )
    } catch (error) {
      // 資料本身不合規（例如電話手機都是空的），重試不會變好
      if (error instanceof TcatOrderInvalid) {
        return { status: 'manual', note: `訂單資料不符合黑貓規格：${error.message}` }
      }
      throw error
    }

    // 2. 建單。
    //
    // 這一步**絕對不能讓錯誤往上拋進 BullMQ 重試**。PrintOBT 沒有冪等鍵，
    // 而失敗有兩種：被退件（單沒成立）和逾時／斷線（單可能已經成立，只是回應沒回來）。
    // 這兩種在我們這端長得一模一樣，無法分辨。自動重試等於在後者的情況下
    // 建出第二張真實託運單 —— 真的會被收兩次運費、倉庫也會多貼一張單。
    //
    // 所以一律轉人工：請人去黑貓後台確認到底建了沒，再決定要不要重送。
    // 代價是網路瞬斷也要人工重觸發，以我們的單量來說這個交換是划算的。
    let result
    try {
      result = await printObt([tcatOrder])
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      console.error('[tcat] 建單失敗', order.orderNo, error)
      return {
        status: 'manual',
        note: `黑貓建單未回覆成功：${reason}。請先到黑貓系統確認訂單 ${tcatOrder.OrderId} 是否已成立，再決定是否重送 —— 直接重送可能會建出第二張託運單。`,
      }
    }

    const obtNumber = result.obtNumbers.get(tcatOrder.OrderId)

    if (!obtNumber) {
      // 建單回成功卻沒給單號，這是不該發生的；留 raw 讓人工去黑貓後台對
      return {
        status: 'manual',
        note: `黑貓回應成功但沒有託運單號，請至黑貓系統確認訂單 ${tcatOrder.OrderId}`,
      }
    }

    // 3. 抓 PDF。失敗不影響託運單已成立的事實，只記下來讓後台重抓
    let label: { path: string; downloadedAt: Date } | undefined
    try {
      const pdf = await downloadObt(result.fileNo)
      label = { path: await saveLabel(order.orderNo, pdf), downloadedAt: new Date() }
    } catch (error) {
      console.error('[tcat] 託運單已建立但 PDF 下載失敗', order.orderNo, error)
    }

    return {
      status: 'created',
      shipmentNo: obtNumber,
      label,
      labelWarning: label
        ? undefined
        : `託運單 ${obtNumber} 已成立，但 PDF 下載失敗。FileNo 只有 24 小時有效，請儘快於後台重試補印。`,
      raw: { obtNumber, fileNo: result.fileNo, printDateTime: result.printDateTime },
    }
  },
}

export function providerFor(shippingMethod: ShippingMethod): ShippingProvider {
  return shippingMethod === 'CVS' ? ecpayCvsProvider : tcatProvider
}

/**
 * 付款成功後建立物流訂單。由 worker 呼叫，失敗會自動重試。
 */
export async function createShipmentForOrder(orderId: string): Promise<void> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { shipment: true, items: true },
  })

  if (!order?.shipment) throw new Error(`訂單沒有物流資料：${orderId}`)

  // 已經建過就不要再建一次（重試或重複派工）。
  // 一定要看 shipmentNo 而不是 allPayLogisticsId —— 後者只有綠界會回，
  // 黑貓建單成功也是空的，光看它會讓每次重試都再建一張真實託運單。
  if (order.shipment.shipmentNo || order.shipment.allPayLogisticsId) return

  if (order.status === 'CANCELLED' || order.status === 'REFUNDED') return

  const result = await providerFor(order.shippingMethod).create(
    order as OrderForShipment,
  )

  // 需要人工建單：留在 PENDING 等後台處理，不要 throw（throw 會讓 BullMQ 一直重試）
  if (result.status === 'manual') {
    await db.$transaction([
      db.shipment.update({
        where: { id: order.shipment.id },
        data: { status: 'PENDING', statusMsg: result.note.slice(0, 500), failReason: null },
      }),
      db.order.update({
        where: { id: order.id },
        data: { status: order.status === 'PAID' ? 'PROCESSING' : order.status },
      }),
    ])
    return
  }

  await db.$transaction([
    db.shipment.update({
      where: { id: order.shipment.id },
      data: {
        allPayLogisticsId: result.allPayLogisticsId ?? null,
        shipmentNo: result.shipmentNo ?? null,
        cvsValidationNo: result.cvsValidationNo ?? null,
        status: 'CREATED',
        // 託運單已成立，所以狀態是 CREATED；但 PDF 沒抓到要留訊息給後台
        failReason: result.labelWarning ?? null,
        labelPath: result.label?.path ?? null,
        labelDownloadedAt: result.label?.downloadedAt ?? null,
        rawResponse: result.raw as Prisma.InputJsonValue,
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

  await advanceOrderForShipmentStatus(shipment.orderId, mapped)
}

/**
 * 物流狀態帶動訂單狀態。
 *
 * 綠界（回拋）與黑貓（輪詢）都會走到這裡 —— 兩邊的規則必須一致，
 * 所以抽成一支共用，不要各自複製一份。
 */
export async function advanceOrderForShipmentStatus(
  orderId: string,
  mapped: ShipmentStatus,
): Promise<void> {
  const orderStatus =
    mapped === 'PICKED_UP'
      ? 'COMPLETED'
      : mapped === 'IN_TRANSIT' || mapped === 'ARRIVED'
        ? 'SHIPPED'
        : null

  if (!orderStatus) return

  const order = await db.order.findUnique({ where: { id: orderId }, select: { status: true } })
  if (!order) return

  // 已完成的訂單不要被較早的狀態往回推
  const isRegression = order.status === 'COMPLETED' && orderStatus === 'SHIPPED'
  if (isRegression || order.status === orderStatus) return

  await db.order.update({ where: { id: orderId }, data: { status: orderStatus } })
  if (orderStatus === 'SHIPPED') {
    await enqueue('send-email', { template: 'shipped', orderId })
  }
}
