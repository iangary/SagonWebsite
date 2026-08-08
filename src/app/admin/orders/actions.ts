'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { OrderStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { createShipmentForOrder } from '@/lib/orders/logistics'
import { issueInvoiceForOrder, voidInvoiceForOrder } from '@/lib/orders/invoice'
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
    return '已向綠界建立物流訂單'
  })
}

export async function adminIssueInvoice(orderId: string): Promise<AdminActionResult> {
  const admin = await requireAdmin()

  return run('開立發票', async () => {
    await issueInvoiceForOrder(orderId)
    await audit({ userId: admin.id, action: 'invoice.issue', entity: 'Order', entityId: orderId })
    revalidatePath(`/admin/orders/${orderId}`)
    return '發票已開立'
  })
}

const voidSchema = z.object({
  orderId: z.string().min(1),
  reason: z.string().trim().min(1, '請填寫作廢原因').max(20, '作廢原因最多 20 字'),
})

export async function adminVoidInvoice(
  orderId: string,
  reason: string,
): Promise<AdminActionResult> {
  const admin = await requireAdmin()

  const parsed = voidSchema.safeParse({ orderId, reason })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? '參數錯誤' }
  }

  return run('作廢發票', async () => {
    await voidInvoiceForOrder(orderId, parsed.data.reason)
    await audit({
      userId: admin.id,
      action: 'invoice.void',
      entity: 'Order',
      entityId: orderId,
      after: { reason: parsed.data.reason },
    })
    revalidatePath(`/admin/orders/${orderId}`)
    return '發票已作廢'
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
