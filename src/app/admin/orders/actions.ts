'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { OrderStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { createShipmentForOrder } from '@/lib/orders/logistics'
import { callTcatPickup } from '@/lib/orders/tcat-pickup'
import { issueReceiptForOrder, voidReceiptForOrder } from '@/lib/orders/receipt'
import { releaseOrderReservations } from '@/lib/orders/stock'
import { markBankTransferPaid, syncPaymentWithEcpay } from '@/lib/orders/payment'
import { markCodCollected } from '@/lib/orders/payment-method'
import { enqueue } from '@/lib/queue'

export type AdminActionResult = { ok: true; message: string } | { ok: false; error: string }

/** 把 action 裡的例外統一轉成給前端顯示的訊息，不要把 stack 吐到畫面上。 */
async function run(
  label: string,
  fn: () => Promise<string>,
): Promise<AdminActionResult> {
  try {
    const message = await fn()
    return { ok: true, message }
  } catch (error) {
    console.error(`[admin] ${label} 失敗`, error)
    return { ok: false, error: (error as Error).message }
  }
}

export async function adminCreateShipment(orderId: string): Promise<AdminActionResult> {
  const admin = await requireAdmin()

  return run('建立物流訂單', async () => {
    await createShipmentForOrder(orderId)
    await audit({ userId: admin.id, action: 'shipment.create', entity: 'Order', entityId: orderId })
    revalidatePath(`/admin/orders/${orderId}`)
    // 超商走綠界、宅配走黑貓，由 providerFor 決定，這裡不必分辨
    return '已建立物流訂單'
  })
}

/**
 * 填入黑貓托運單號並標記已出貨。
 *
 * 黑貓已改為 API 自動建單（見 lib/orders/logistics.ts 的 tcatProvider），
 * 這支只留給例外情況補單 —— 最常見的是建單請求逾時、單其實已經成立，
 * 這時不能重送（會建出第二張），只能到黑貓後台抄單號回填。
 */
const tcatSchema = z.object({
  orderId: z.string().min(1),
  shipmentNo: z
    .string()
    .trim()
    .min(1, '請填寫黑貓托運單號')
    .max(30, '托運單號最多 30 字')
    .regex(/^[A-Za-z0-9-]+$/, '托運單號只能是英數與連字號'),
})

export async function adminRecordTcatShipment(
  orderId: string,
  shipmentNo: string,
): Promise<AdminActionResult> {
  const admin = await requireAdmin()

  const parsed = tcatSchema.safeParse({ orderId, shipmentNo })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '參數錯誤' }
  }

  return run('回填黑貓托運單號', async () => {
    const order = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true, shippingMethod: true, shipment: { select: { id: true } } },
    })

    if (order.shippingMethod !== 'HOME') {
      throw new Error('只有宅配訂單需要回填黑貓托運單號')
    }
    if (!order.shipment) throw new Error('這張訂單沒有物流資料')

    await db.$transaction([
      db.shipment.update({
        where: { id: order.shipment.id },
        data: {
          shipmentNo: parsed.data.shipmentNo,
          status: 'IN_TRANSIT',
          statusMsg: '已於黑貓系統建單並出貨',
          failReason: null,
        },
      }),
      db.order.update({ where: { id: orderId }, data: { status: 'SHIPPED' } }),
    ])

    await audit({
      userId: admin.id,
      action: 'shipment.tcat.record',
      entity: 'Order',
      entityId: orderId,
      after: { shipmentNo: parsed.data.shipmentNo },
    })
    await enqueue('send-email', { template: 'shipped', orderId })

    revalidatePath(`/admin/orders/${orderId}`)
    revalidatePath('/admin/orders')
    return '已回填托運單號並標記為已出貨'
  })
}

/**
 * 呼叫黑貓派車來收貨（規格 2.6）。
 *
 * 這不是針對單一訂單，而是「今天倉庫有貨要交寄」的一次性通知：
 * 黑貓每個收貨點一天只受理一次，也不能指定時段，司機依當日路線過來。
 * 所以按下去之前包裹要先打包好貼好託運單。每日一次的鎖在 callTcatPickup 裡。
 */
const pickupSchema = z.object({
  quantity: z.number().int().min(1, '出貨件數至少 1 件').max(999, '一次最多 999 件'),
  memo: z.string().trim().max(100, '備註最多 100 字').optional(),
})

export async function adminCallTcatPickup(
  quantity: number,
  memo?: string,
): Promise<AdminActionResult> {
  const admin = await requireAdmin()

  const parsed = pickupSchema.safeParse({ quantity, memo })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '參數錯誤' }
  }

  return run('呼叫黑貓收貨', async () => {
    const call = await callTcatPickup({
      quantity: parsed.data.quantity,
      memo: parsed.data.memo,
      requestedById: admin.id,
    })

    await audit({
      userId: admin.id,
      action: 'shipment.tcat.pickup',
      entity: 'TcatPickupCall',
      entityId: call.id,
      after: { quantity: call.quantity, srvTranId: call.srvTranId },
    })

    revalidatePath('/admin/orders')
    // 黑貓的回覆會寫「司機將於 X 點後前往取件」，原樣顯示比我們自己編有用
    return call.message ?? '集貨通知已送出'
  })
}

/**
 * 回填人工開立的紙本發票號碼。
 * 我們沒有申請綠界電子發票，發票是人工開立、隨包裹寄出，這裡只留紀錄供客服查詢。
 */
const invoiceRecordSchema = z.object({
  orderId: z.string().min(1),
  invoiceNumber: z
    .string()
    .trim()
    .regex(/^[A-Z]{2}\d{8}$/, '發票號碼格式為 2 碼英文字母加 8 位數字，例如 AB12345678'),
})

export async function adminRecordInvoice(
  orderId: string,
  invoiceNumber: string,
): Promise<AdminActionResult> {
  const admin = await requireAdmin()

  const parsed = invoiceRecordSchema.safeParse({ orderId, invoiceNumber })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '參數錯誤' }
  }

  return run('回填發票號碼', async () => {
    await db.invoice.update({
      where: { orderId },
      data: {
        invoiceNumber: parsed.data.invoiceNumber,
        invoiceDate: new Date(),
        status: 'ISSUED',
      },
    })
    await audit({
      userId: admin.id,
      action: 'invoice.record',
      entity: 'Order',
      entityId: orderId,
      after: { invoiceNumber: parsed.data.invoiceNumber },
    })
    revalidatePath(`/admin/orders/${orderId}`)
    return '已回填發票號碼'
  })
}

export async function adminIssueReceipt(orderId: string): Promise<AdminActionResult> {
  const admin = await requireAdmin()

  return run('開立電子收據', async () => {
    await issueReceiptForOrder(orderId)
    await audit({ userId: admin.id, action: 'receipt.issue', entity: 'Order', entityId: orderId })
    revalidatePath(`/admin/orders/${orderId}`)
    return '電子收據已開立'
  })
}

const voidSchema = z.object({
  orderId: z.string().min(1),
  reason: z.string().trim().min(1, '請填寫作廢原因').max(200, '作廢原因最多 200 字'),
})

export async function adminVoidReceipt(
  orderId: string,
  reason: string,
): Promise<AdminActionResult> {
  const admin = await requireAdmin()

  const parsed = voidSchema.safeParse({ orderId, reason })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '參數錯誤' }
  }

  return run('作廢電子收據', async () => {
    await voidReceiptForOrder(orderId, parsed.data.reason)
    await audit({
      userId: admin.id,
      action: 'receipt.void',
      entity: 'Order',
      entityId: orderId,
      after: { reason: parsed.data.reason },
    })
    revalidatePath(`/admin/orders/${orderId}`)
    return '電子收據已作廢'
  })
}

const ALLOWED_MANUAL_STATUS: OrderStatus[] = ['PROCESSING', 'SHIPPED', 'COMPLETED', 'REFUNDED']

export async function adminUpdateOrderStatus(
  orderId: string,
  status: OrderStatus,
): Promise<AdminActionResult> {
  const admin = await requireAdmin()

  if (!ALLOWED_MANUAL_STATUS.includes(status)) {
    // PENDING_PAYMENT / PAID / CANCELLED 由金流與排程決定，不開放人工直接指定
    return { ok: false, error: '這個狀態不能手動設定' }
  }

  return run('更新訂單狀態', async () => {
    const before = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true },
    })

    await db.order.update({
      where: { id: orderId },
      data: {
        status,
        // 手動改成已完成也要記時點，否則這張訂單不會進評論邀請的排程
        ...(status === 'COMPLETED' ? { completedAt: new Date() } : {}),
      },
    })
    await audit({
      userId: admin.id,
      action: 'order.status',
      entity: 'Order',
      entityId: orderId,
      before,
      after: { status },
    })

    if (status === 'SHIPPED') {
      await enqueue('send-email', { template: 'shipped', orderId })
    }

    revalidatePath(`/admin/orders/${orderId}`)
    revalidatePath('/admin/orders')
    return `訂單狀態已更新為「${status}」`
  })
}

/**
 * 人工取消訂單。只允許取消尚未付款的訂單 ——
 * 已付款的要走退款流程，不能只把狀態改掉就了事。
 */
export async function adminCancelOrder(orderId: string): Promise<AdminActionResult> {
  const admin = await requireAdmin()

  return run('取消訂單', async () => {
    const order = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true },
    })

    if (order.status !== 'PENDING_PAYMENT') {
      throw new Error('只有待付款的訂單可以直接取消；已付款的訂單請先辦理退款')
    }

    await db.$transaction(async (tx) => {
      await releaseOrderReservations(tx, orderId)
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      })
      await tx.payment.updateMany({
        where: { orderId, status: { in: ['PENDING', 'AWAITING_TRANSFER'] } },
        data: { status: 'EXPIRED' },
      })
    })

    await audit({
      userId: admin.id,
      action: 'order.cancel',
      entity: 'Order',
      entityId: orderId,
      before: order,
    })
    await enqueue('send-email', { template: 'order-cancelled', orderId })

    revalidatePath(`/admin/orders/${orderId}`)
    revalidatePath('/admin/orders')
    return '訂單已取消，庫存已釋放'
  })
}

/**
 * 向綠界查詢這張訂單到底付款了沒（QueryTradeInfo）。
 *
 * 存在的理由：ReturnURL 是「綠界打得到我們」才會成立的機制，CDN、憑證、
 * 主機重啟都可能讓那通通知永久遺失 —— 消費者繳了錢、我們的訂單卻還停在待付款。
 * 排程每 15 分鐘會自動掃一次（reconcile-payments），這支是客服當場想確認時用的。
 */
export async function adminSyncPayment(orderId: string): Promise<AdminActionResult> {
  const admin = await requireAdmin()

  return run('查詢綠界付款狀態', async () => {
    const payment = await db.payment.findFirst({
      where: { orderId, supersededAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, provider: true, merchantTradeNo: true },
    })
    if (!payment) throw new Error('這張訂單沒有付款紀錄')
    if (payment.provider !== 'ECPAY') {
      throw new Error('這張訂單不是綠界金流（貨到付款／匯款），請用「標記已收款」')
    }

    const result = await syncPaymentWithEcpay(payment.id)

    await audit({
      userId: admin.id,
      action: 'payment.sync',
      entity: 'Order',
      entityId: orderId,
      after: { tradeStatus: result.tradeStatus, paid: result.paid },
    })

    revalidatePath(`/admin/orders/${orderId}`)
    revalidatePath('/admin/orders')

    if (result.paid) {
      return result.changed
        ? '綠界確認已付款，訂單已更新為已付款並開始後續流程'
        : '綠界確認已付款（我們這邊本來就已入帳）'
    }
    if (result.tradeStatus === '0') return '綠界回報：訂單已建立但消費者還沒付款'
    if (result.tradeStatus === '10200095') return '綠界回報：交易失敗，消費者沒有完成付款'
    return `綠界回報 TradeStatus=${result.tradeStatus || '(空值，查無此筆交易)'}`
  })
}

/**
 * 貨到付款：手動標記已收款。
 *
 * 正常情況下超商回拋「已取貨」或黑貓回報「已配達」就會自動標記
 * （見 lib/orders/logistics.ts 的 advanceOrderForShipmentStatus），
 * 這支留給對帳對出來、或物流狀態沒回來的例外情況。
 */
export async function adminMarkCodCollected(orderId: string): Promise<AdminActionResult> {
  const admin = await requireAdmin()

  return run('標記貨到付款已收款', async () => {
    const collected = await markCodCollected(orderId, {
      note: `由 ${admin.email ?? admin.id} 於後台手動確認收款`,
    })
    if (!collected) throw new Error('這張訂單沒有待收款的貨到付款紀錄')

    await audit({
      userId: admin.id,
      action: 'payment.cod.collected',
      entity: 'Order',
      entityId: orderId,
    })

    revalidatePath(`/admin/orders/${orderId}`)
    revalidatePath('/admin/orders')
    return '已標記為收款完成'
  })
}

/**
 * 匯款到公司帳戶：確認錢進來了。
 *
 * 這個付款方式沒有任何自動入帳通知（錢直接進公司帳戶，不經綠界），
 * 所以這顆按鈕是這種訂單**唯一**的付款成立路徑 —— 按下去之後庫存實扣、
 * 建物流單、開收據、寄確認信，與綠界付款成功走的是同一段流程。
 *
 * 對帳備註（末五碼、入帳日）會一起存進付款紀錄，日後有爭議才查得回來。
 */
const bankPaidSchema = z.object({
  orderId: z.string().min(1),
  note: z.string().trim().max(200, '對帳備註最多 200 字').optional(),
})

export async function adminMarkBankTransferPaid(
  orderId: string,
  note?: string,
): Promise<AdminActionResult> {
  const admin = await requireAdmin()

  const parsed = bankPaidSchema.safeParse({ orderId, note })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '參數錯誤' }
  }

  return run('標記匯款已入帳', async () => {
    const order = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true },
    })
    // 已取消的訂單也讓它過 —— 錢真的進來了就得留紀錄，
    // markBankTransferPaid 會自動開一張退款單（逾期入帳）。
    if (!['PENDING_PAYMENT', 'CANCELLED'].includes(order.status)) {
      throw new Error('這張訂單已經不在等待匯款，請先確認付款紀錄')
    }

    const who = admin.email ?? admin.id
    const marked = await markBankTransferPaid({
      orderId,
      note: [parsed.data.note, `由 ${who} 於後台確認入帳`].filter(Boolean).join('／'),
    })
    if (!marked) throw new Error('這張訂單沒有等待匯款的付款紀錄')

    await audit({
      userId: admin.id,
      action: 'payment.bank.paid',
      entity: 'Order',
      entityId: orderId,
      after: { note: parsed.data.note ?? '' },
    })

    revalidatePath(`/admin/orders/${orderId}`)
    revalidatePath('/admin/orders')
    return order.status === 'CANCELLED'
      ? '已登錄入帳。這張訂單先前已因逾期取消，系統已開立退款單'
      : '已確認入帳，訂單進入備貨流程'
  })
}
