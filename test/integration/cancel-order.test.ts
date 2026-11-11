import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', async () => (await import('./mocks')).authMockModule())
vi.mock('next/headers', async () => (await import('./mocks')).nextHeadersMockModule())
vi.mock('@/lib/queue', async () => (await import('./mocks')).queueMockModule())
vi.mock('next-intl/server', async () => (await import('./mocks')).nextIntlServerMockModule())

import { db } from '@/lib/db'
import { cancelOrderAction } from '@/app/[locale]/checkout/result/actions'
import { handlePaymentReturn } from '@/lib/orders/payment'
import { releaseExpiredReservations } from '@/lib/orders/stock'
import { createTestCoupon, createTestOrder, createTestUser, reloadOrder } from '../factories'
import { enqueueMock, mockAuthUser } from './mocks'
import { signedPaymentReturnParams } from './helpers/ecpay'

/**
 * 消費者自己取消待付款訂單。
 *
 * 重點在邊界：只有本人（或拿得出訂購 Email／手機的訪客）能取消、
 * 只有待付款能取消、取消後庫存與折扣碼要還回去、取消後才進來的錢要開退款單。
 */

const INITIAL = { ok: false }

function form(fields: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

async function freshVariant(id: string) {
  return db.productVariant.findUniqueOrThrow({ where: { id } })
}

beforeEach(() => {
  enqueueMock.mockClear()
  mockAuthUser(null)
})

describe('cancelOrderAction — 消費者取消待付款訂單', () => {
  it('會員取消自己的訂單：狀態、庫存、付款紀錄、通知信', async () => {
    const user = await createTestUser()
    const { order, variant } = await createTestOrder({ userId: user.id, qty: 2 })
    expect((await freshVariant(variant.id)).reservedStock).toBe(2)

    mockAuthUser({ id: user.id, role: 'CUSTOMER' })
    const result = await cancelOrderAction(INITIAL, form({ orderNo: order.orderNo }))

    expect(result).toEqual({ ok: true, refresh: true })
    const fresh = await reloadOrder(order.id)
    expect(fresh.status).toBe('CANCELLED')
    expect(fresh.cancelledAt).not.toBeNull()
    expect(fresh.payments[0].status).toBe('EXPIRED')
    expect(fresh.reservations.every((r) => r.releasedAt !== null)).toBe(true)
    expect((await freshVariant(variant.id)).reservedStock).toBe(0)

    expect(enqueueMock).toHaveBeenCalledWith('send-email', {
      template: 'order-cancelled-by-customer',
      orderId: order.id,
    })
  })

  it('訪客沒給聯絡方式 → 要求驗證身分，訂單不動', async () => {
    const { order } = await createTestOrder()

    const result = await cancelOrderAction(INITIAL, form({ orderNo: order.orderNo }))

    expect(result).toMatchObject({ ok: false, needsContact: true })
    expect((await reloadOrder(order.id)).status).toBe('PENDING_PAYMENT')
  })

  it('訪客聯絡方式不符 → 擋下', async () => {
    const { order } = await createTestOrder()

    const result = await cancelOrderAction(
      INITIAL,
      form({ orderNo: order.orderNo, contact: 'someone-else@test.local' }),
    )

    expect(result).toMatchObject({ ok: false, needsContact: true })
    expect((await reloadOrder(order.id)).status).toBe('PENDING_PAYMENT')
  })

  it('訪客用訂購手機驗證 → 可以取消', async () => {
    const { order } = await createTestOrder()

    const result = await cancelOrderAction(
      INITIAL,
      form({ orderNo: order.orderNo, contact: '0912-345-678' }),
    )

    expect(result.ok).toBe(true)
    expect((await reloadOrder(order.id)).status).toBe('CANCELLED')
  })

  it('別的會員登入也不能取消（不是本人又沒給聯絡方式）', async () => {
    const owner = await createTestUser()
    const other = await createTestUser()
    const { order } = await createTestOrder({ userId: owner.id })

    mockAuthUser({ id: other.id, role: 'CUSTOMER' })
    const result = await cancelOrderAction(INITIAL, form({ orderNo: order.orderNo }))

    expect(result.ok).toBe(false)
    expect((await reloadOrder(order.id)).status).toBe('PENDING_PAYMENT')
  })

  it.each(['PAID', 'PROCESSING', 'SHIPPED', 'CANCELLED'] as const)(
    '%s 的訂單不能自己取消',
    async (status) => {
      const user = await createTestUser()
      const { order } = await createTestOrder({
        userId: user.id,
        status,
        withReservations: false,
      })

      mockAuthUser({ id: user.id, role: 'CUSTOMER' })
      const result = await cancelOrderAction(INITIAL, form({ orderNo: order.orderNo }))

      expect(result).toEqual({ ok: false, refresh: true, error: 'cancelOrderNotPending' })
      expect((await reloadOrder(order.id)).status).toBe(status)
      expect(enqueueMock).not.toHaveBeenCalled()
    },
  )

  it('折扣碼還回去：usedCount -1、兌換紀錄刪掉，可以重新下單再用', async () => {
    const user = await createTestUser()
    const coupon = await createTestCoupon({ perUserLimit: 1, usedCount: 1 })
    const { order } = await createTestOrder({ userId: user.id })
    await db.order.update({ where: { id: order.id }, data: { couponId: coupon.id } })
    await db.couponRedemption.create({
      data: { couponId: coupon.id, userId: user.id, orderId: order.id },
    })

    mockAuthUser({ id: user.id, role: 'CUSTOMER' })
    await cancelOrderAction(INITIAL, form({ orderNo: order.orderNo }))

    const freshCoupon = await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })
    expect(freshCoupon.usedCount).toBe(0)
    expect(await db.couponRedemption.count({ where: { orderId: order.id } })).toBe(0)
    // 訂單上仍看得出用過哪張券
    expect((await reloadOrder(order.id)).couponId).toBe(coupon.id)
  })

  it('取消後才收到綠界付款 → 訂單留在已取消，自動開退款單', async () => {
    const user = await createTestUser()
    const { order } = await createTestOrder({ userId: user.id })

    mockAuthUser({ id: user.id, role: 'CUSTOMER' })
    await cancelOrderAction(INITIAL, form({ orderNo: order.orderNo }))
    await handlePaymentReturn(signedPaymentReturnParams(order))

    expect((await reloadOrder(order.id)).status).toBe('CANCELLED')
    const refund = await db.refundRequest.findFirstOrThrow({ where: { orderId: order.id } })
    expect(refund.reason).toContain('訂單已取消')
  })

  // 跑很多次才抓得到交錯：曾經出過「付款先讀到待付款、等鎖、再把剛取消的單蓋回 PAID」
  // —— 庫存已經放掉了，結果是超賣。
  it.each(Array.from({ length: 8 }, (_, i) => i))(
    '取消與付款通知同時進來（第 %i 輪）：不超賣、錢不會被吞掉',
    async () => {
      const user = await createTestUser()
      const { order, variant } = await createTestOrder({ userId: user.id })

      mockAuthUser({ id: user.id, role: 'CUSTOMER' })
      const [cancel, pay] = await Promise.allSettled([
        cancelOrderAction(INITIAL, form({ orderNo: order.orderNo })),
        handlePaymentReturn(signedPaymentReturnParams(order)),
      ])
      // 兩邊都不該因為死鎖而炸掉
      expect(cancel.status).toBe('fulfilled')
      expect(pay.status).toBe('fulfilled')

      const fresh = await reloadOrder(order.id)
      const reservation = fresh.reservations[0]
      const v = await freshVariant(variant.id)
      expect(v.reservedStock).toBe(0)

      if (fresh.status === 'PAID') {
        expect(reservation.committedAt).not.toBeNull()
        expect(v.stock).toBe(9)
        expect(cancel.status === 'fulfilled' && cancel.value.ok).toBe(false)
      } else {
        expect(fresh.status).toBe('CANCELLED')
        expect(reservation.releasedAt).not.toBeNull()
        expect(reservation.committedAt).toBeNull()
        expect(v.stock).toBe(10)
        // 錢進來了就要有退款單
        expect(fresh.payment?.status).toBe('PAID')
        expect(await db.refundRequest.count({ where: { orderId: order.id } })).toBe(1)
      }
    },
  )

  it('同一筆付款通知同時重送兩份：只入帳一次、不開退款單', async () => {
    const { order } = await createTestOrder()
    const params = signedPaymentReturnParams(order)

    await Promise.all([handlePaymentReturn(params), handlePaymentReturn(params)])

    expect((await reloadOrder(order.id)).status).toBe('PAID')
    expect(await db.refundRequest.count({ where: { orderId: order.id } })).toBe(0)
  })

  it('逾期排程不會把消費者自己取消的單算進去、也不會寄逾期信', async () => {
    const user = await createTestUser()
    const { order } = await createTestOrder({
      userId: user.id,
      reservationExpiresAt: new Date(Date.now() - 60_000),
    })
    const { order: expired } = await createTestOrder({
      reservationExpiresAt: new Date(Date.now() - 60_000),
    })

    mockAuthUser({ id: user.id, role: 'CUSTOMER' })
    await cancelOrderAction(INITIAL, form({ orderNo: order.orderNo }))

    const result = await releaseExpiredReservations()

    expect(result.cancelledOrderIds).toContain(expired.id)
    expect(result.cancelledOrderIds).not.toContain(order.id)
  })
})
