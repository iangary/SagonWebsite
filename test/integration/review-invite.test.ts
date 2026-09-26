import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import {
  REVIEW_INVITE_DELAY_DAYS,
  claimReviewInvite,
  findOrdersAwaitingReviewInvite,
  releaseReviewInvite,
} from '@/lib/orders/review-invite'
import { createTestOrder, createTestProduct, createTestUser } from '../factories'
import type { ProductVariant, User } from '@prisma/client'

/**
 * 評論邀請信的挑單與去重。
 *
 * 放整合測試而不是單元測試，是因為要驗的核心是 claimReviewInvite 的
 * 條件式更新在「兩輪排程同時跑」時會不會重複寄信 —— 那要真的資料庫
 * 與真的併發交易才測得出來。
 */

const DAY = 24 * 60 * 60 * 1000

let user: User
let variant: ProductVariant

beforeEach(async () => {
  user = await createTestUser()
  const created = await createTestProduct({ stock: 10 })
  variant = created.variants[0]
})

/** 建一張「已完成、完成於 N 天前」的訂單。userId: null 代表訪客訂單。 */
async function completedOrder(daysAgo: number, overrides: { userId?: string | null } = {}) {
  const isGuest = overrides.userId === null
  const { order } = await createTestOrder({
    variant,
    status: 'COMPLETED',
    userId: isGuest ? undefined : (overrides.userId ?? user.id),
    withReservations: false,
  })
  await db.order.update({
    where: { id: order.id },
    data: { completedAt: new Date(Date.now() - daysAgo * DAY) },
  })
  return order
}

describe('findOrdersAwaitingReviewInvite', () => {
  it('完成滿 7 天的訂單會被挑出來', async () => {
    const order = await completedOrder(REVIEW_INVITE_DELAY_DAYS + 1)
    const found = await findOrdersAwaitingReviewInvite()
    expect(found.map((o) => o.id)).toContain(order.id)
  })

  it('還沒滿 7 天的不挑', async () => {
    // 太快寄客人還沒穿過
    await completedOrder(REVIEW_INVITE_DELAY_DAYS - 1)
    expect(await findOrdersAwaitingReviewInvite()).toHaveLength(0)
  })

  it('沒有 completedAt 的舊訂單不挑', async () => {
    // 這個欄位是後來才加的，既有訂單是 null，不能算成「完成於 1970 年」
    const { order } = await createTestOrder({
      variant,
      status: 'COMPLETED',
      userId: user.id,
      withReservations: false,
    })
    await db.order.update({ where: { id: order.id }, data: { completedAt: null } })
    expect(await findOrdersAwaitingReviewInvite()).toHaveLength(0)
  })

  it('未完成的訂單不挑', async () => {
    const { order } = await createTestOrder({
      variant,
      status: 'SHIPPED',
      userId: user.id,
      withReservations: false,
    })
    await db.order.update({
      where: { id: order.id },
      data: { completedAt: new Date(Date.now() - 30 * DAY) },
    })
    expect(await findOrdersAwaitingReviewInvite()).toHaveLength(0)
  })

  it('訪客訂單不挑', async () => {
    // 評論要綁會員帳號，訪客沒有地方可以寫，寄了只是打擾
    await completedOrder(REVIEW_INVITE_DELAY_DAYS + 1, { userId: null })
    expect(await findOrdersAwaitingReviewInvite()).toHaveLength(0)
  })

  it('已經寄過的不會再挑', async () => {
    const order = await completedOrder(REVIEW_INVITE_DELAY_DAYS + 1)
    await claimReviewInvite(order.id)
    expect(await findOrdersAwaitingReviewInvite()).toHaveLength(0)
  })

  it('每一項都評過的訂單不挑', async () => {
    const order = await completedOrder(REVIEW_INVITE_DELAY_DAYS + 1)
    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } })

    await db.review.create({
      data: {
        productId: variant.productId,
        userId: user.id,
        orderItemId: item.id,
        rating: 5,
        body: '很好穿',
      },
    })

    expect(await findOrdersAwaitingReviewInvite()).toHaveLength(0)
  })
})

describe('claimReviewInvite', () => {
  it('第一次搶得到，第二次搶不到', async () => {
    const order = await completedOrder(REVIEW_INVITE_DELAY_DAYS + 1)

    expect(await claimReviewInvite(order.id)).toBe(true)
    expect(await claimReviewInvite(order.id)).toBe(false)
  })

  it('兩輪排程同時跑，只有一個搶得到 —— 客人不會收到兩封', async () => {
    const order = await completedOrder(REVIEW_INVITE_DELAY_DAYS + 1)

    const results = await Promise.all([
      claimReviewInvite(order.id),
      claimReviewInvite(order.id),
      claimReviewInvite(order.id),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('寄信失敗後解除標記，下一輪會重新挑到', async () => {
    const order = await completedOrder(REVIEW_INVITE_DELAY_DAYS + 1)

    await claimReviewInvite(order.id)
    expect(await findOrdersAwaitingReviewInvite()).toHaveLength(0)

    await releaseReviewInvite(order.id)
    expect((await findOrdersAwaitingReviewInvite()).map((o) => o.id)).toContain(order.id)
  })
})
