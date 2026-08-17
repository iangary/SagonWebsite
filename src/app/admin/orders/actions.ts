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

    await db.order.update({ where: { id: orderId }, data: { status } })
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
