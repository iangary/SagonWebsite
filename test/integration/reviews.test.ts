import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', async () => (await import('./mocks')).authMockModule())
vi.mock('next/cache', async () => (await import('./mocks')).nextCacheMockModule())
vi.mock('next/headers', async () => (await import('./mocks')).nextHeadersMockModule())
vi.mock('next-intl/server', async () => (await import('./mocks')).nextIntlServerMockModule())

import { db } from '@/lib/db'
import { submitReview, type ReviewState } from '@/app/[locale]/account/orders/[id]/review/actions'
import { moderateReview } from '@/app/admin/reviews/actions'
import { getProductBySlug } from '@/lib/catalog/queries'
import { createTestOrder, createTestProduct, createTestUser } from '../factories'
import { mockAuthUser, resetCookieJar, revalidatePathMock } from './mocks'
import type { OrderStatus, Product, ProductVariant, User } from '@prisma/client'

/**
 * 商品評論整合測試：前台送評（submitReview）、後台審核（moderateReview）、
 * 以及前台只看得到 APPROVED 的可見性。
 *
 * next-intl 走 mock（翻譯函式原樣回 key），斷言 error === 'purchaseNotFound'
 * 比斷言中文字串穩定；文案改了不會誤報。
 */

const EMPTY_STATE: ReviewState = { ok: false }

function reviewFormData(entries: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [key, value] of Object.entries(entries)) fd.append(key, value)
  return fd
}

interface Purchase {
  user: User
  product: Product
  variants: ProductVariant[]
  orderId: string
  orderItemId: string
}

/** 建一位買家 + 一張指定狀態的訂單（預設 COMPLETED，也就是可以評論的狀態） */
async function seedPurchase(
  options: { status?: OrderStatus; variantCount?: number; user?: User } = {},
): Promise<Purchase> {
  const { product, variants } = await createTestProduct({
    variantCount: options.variantCount ?? 1,
  })
  const user = options.user ?? (await createTestUser())
  const { order } = await createTestOrder({
    userId: user.id,
    variant: variants[0],
    status: options.status ?? 'COMPLETED',
    withReservations: false,
  })
  return { user, product, variants, orderId: order.id, orderItemId: order.items[0].id }
}

/** 送出一則合法評論的表單（可覆寫任一欄位） */
function validForm(p: Purchase, overrides: Record<string, string> = {}): FormData {
  return reviewFormData({
    orderItemId: p.orderItemId,
    productId: p.product.id,
    rating: '5',
    title: '很喜歡',
    body: '穿起來很舒服，尺寸也很準，會回購。',
    ...overrides,
  })
}

beforeEach(() => {
  resetCookieJar()
  revalidatePathMock.mockClear()
  mockAuthUser(null)
})

describe('submitReview：正常送出', () => {
  it('已完成訂單的購買人送評 → 建立 PENDING 評論、內容正確、revalidate 訂單頁', async () => {
    const p = await seedPurchase()
    mockAuthUser({ id: p.user.id, role: 'CUSTOMER' })

    const state = await submitReview(EMPTY_STATE, validForm(p, { rating: '4' }))

    expect(state.ok).toBe(true)
    expect(state.message).toBe('submitted')

    const review = await db.review.findUniqueOrThrow({ where: { orderItemId: p.orderItemId } })
    // 新評論一律待審，不能一送出就出現在商品頁上
    expect(review.status).toBe('PENDING')
    expect(review.rating).toBe(4)
    expect(review.title).toBe('很喜歡')
    expect(review.body).toBe('穿起來很舒服，尺寸也很準，會回購。')
    expect(review.productId).toBe(p.product.id)
    expect(review.userId).toBe(p.user.id)
    expect(review.moderatedAt).toBeNull()

    expect(revalidatePathMock).toHaveBeenCalledWith('/account/orders')
  })

  it('標題留白 → 存成 null 而不是空字串', async () => {
    const p = await seedPurchase()
    mockAuthUser({ id: p.user.id, role: 'CUSTOMER' })

    const state = await submitReview(EMPTY_STATE, validForm(p, { title: '   ' }))

    expect(state.ok).toBe(true)
    const review = await db.review.findUniqueOrThrow({ where: { orderItemId: p.orderItemId } })
    expect(review.title).toBeNull()
  })

  it('同一張訂單的不同項目可以各自評論一次', async () => {
    const p = await seedPurchase({ variantCount: 2 })
    mockAuthUser({ id: p.user.id, role: 'CUSTOMER' })

    const secondItem = await db.orderItem.create({
      data: {
        orderId: p.orderId,
        variantId: p.variants[1].id,
        productName: '測試商品',
        variantName: p.variants[1].name,
        sku: p.variants[1].sku,
        unitPrice: p.variants[1].price,
        qty: 1,
        lineTotal: p.variants[1].price,
      },
    })

    const first = await submitReview(EMPTY_STATE, validForm(p))
    const second = await submitReview(
      EMPTY_STATE,
      validForm(p, { orderItemId: secondItem.id, rating: '3', body: '第二個規格的心得，還可以。' }),
    )

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(await db.review.count({ where: { productId: p.product.id } })).toBe(2)
  })
})

describe('submitReview：購買資格', () => {
  it('未登入 → requireUser 拋錯，不寫入', async () => {
    const p = await seedPurchase()
    mockAuthUser(null)

    await expect(submitReview(EMPTY_STATE, validForm(p))).rejects.toThrow('UNAUTHORIZED')
    expect(await db.review.count()).toBe(0)
  })

  it.each<OrderStatus>(['PENDING_PAYMENT', 'PAID', 'SHIPPED'])(
    '訂單狀態為 %s（尚未完成）→ purchaseNotFound，不寫入',
    async (status) => {
      const p = await seedPurchase({ status })
      mockAuthUser({ id: p.user.id, role: 'CUSTOMER' })

      const state = await submitReview(EMPTY_STATE, validForm(p))

      expect(state).toEqual({ ok: false, error: 'purchaseNotFound' })
      expect(await db.review.count()).toBe(0)
    },
  )

  it('不是本人的訂單項目 → purchaseNotFound，不寫入', async () => {
    const p = await seedPurchase()
    const stranger = await createTestUser()
    mockAuthUser({ id: stranger.id, role: 'CUSTOMER' })

    const state = await submitReview(EMPTY_STATE, validForm(p))

    expect(state).toEqual({ ok: false, error: 'purchaseNotFound' })
    expect(await db.review.count()).toBe(0)
  })

  it('orderItemId 不存在 → purchaseNotFound', async () => {
    const p = await seedPurchase()
    mockAuthUser({ id: p.user.id, role: 'CUSTOMER' })

    const state = await submitReview(
      EMPTY_STATE,
      validForm(p, { orderItemId: 'no-such-order-item' }),
    )

    expect(state).toEqual({ ok: false, error: 'purchaseNotFound' })
    expect(await db.review.count()).toBe(0)
  })

  it('productId 被改成別的商品（想灌沒買過的商品）→ productMismatch，不寫入', async () => {
    const p = await seedPurchase()
    const other = await createTestProduct()
    mockAuthUser({ id: p.user.id, role: 'CUSTOMER' })

    const state = await submitReview(
      EMPTY_STATE,
      validForm(p, { productId: other.product.id }),
    )

    expect(state).toEqual({ ok: false, error: 'productMismatch' })
    expect(await db.review.count()).toBe(0)
  })
})

describe('submitReview：重複評論', () => {
  it('同一個訂單項目評論第二次 → alreadyReviewed，資料庫仍只有一筆', async () => {
    const p = await seedPurchase()
    mockAuthUser({ id: p.user.id, role: 'CUSTOMER' })

    const first = await submitReview(EMPTY_STATE, validForm(p))
    const second = await submitReview(
      EMPTY_STATE,
      validForm(p, { rating: '1', body: '想再罵一次，改成一顆星。' }),
    )

    expect(first.ok).toBe(true)
    expect(second).toEqual({ ok: false, error: 'alreadyReviewed' })

    const reviews = await db.review.findMany({ where: { orderItemId: p.orderItemId } })
    expect(reviews).toHaveLength(1)
    expect(reviews[0].rating).toBe(5) // 第二次沒有覆寫掉第一次
  })

  it('併發送出兩次相同評論 → 只有一筆落地，但輸掉競態的一邊噴出未捕捉的 P2002', async () => {
    const p = await seedPurchase()
    mockAuthUser({ id: p.user.id, role: 'CUSTOMER' })

    // 先逼連線池開出多條連線。池子裡只有一條連線時，兩次呼叫會被排隊成
    // 序列（第二次的 findUnique 落在第一次 create 之後），競態就重現不出來；
    // 正式站同時有多個請求，連線一定是多條的。
    await Promise.all(Array.from({ length: 4 }, () => db.$queryRaw`SELECT 1`))

    // 「先 findUnique 查有沒有、再 create」之間有空窗，兩邊都會通過預檢；
    // 真正擋住第二筆的只有 reviews.orderItemId 的唯一索引。
    const results = await Promise.allSettled([
      submitReview(EMPTY_STATE, validForm(p)),
      submitReview(EMPTY_STATE, validForm(p)),
    ])

    // 最重要的不變量：不管誰贏，資料庫只留下一筆
    expect(await db.review.count({ where: { orderItemId: p.orderItemId } })).toBe(1)
    expect(results.filter((r) => r.status === 'fulfilled' && r.value.ok)).toHaveLength(1)

    // 現況（缺陷）：submitReview 沒有把 db.review.create 包在 try/catch 裡，
    // 輸的一邊直接把 Prisma 的唯一鍵違反往外拋 —— 使用者連點兩下送出看到的
    // 是 500，而不是「這個項目已經評論過了」。
    // 修好之後（create 捕捉 P2002 → 回 alreadyReviewed）這兩行要改成
    // 斷言 loser 是 { ok: false, error: 'alreadyReviewed' }。
    const loser = results.find((r) => !(r.status === 'fulfilled' && r.value.ok))!
    expect(loser.status).toBe('rejected')
    expect((loser as PromiseRejectedResult).reason).toMatchObject({ code: 'P2002' })
  })
})

describe('submitReview：欄位驗證', () => {
  it.each([
    ['0（低於下限）', '0'],
    ['6（高於上限）', '6'],
    ['2.5（非整數）', '2.5'],
  ])('評分為 %s → fieldErrors.rating，不寫入', async (_label, rating) => {
    const p = await seedPurchase()
    mockAuthUser({ id: p.user.id, role: 'CUSTOMER' })

    const state = await submitReview(EMPTY_STATE, validForm(p, { rating }))

    expect(state.ok).toBe(false)
    expect(state.fieldErrors?.rating).toBeDefined()
    expect(state.error).toBeUndefined()
    expect(await db.review.count()).toBe(0)
  })

  it('評分為 0 時回的是 ratingRequired 這個訊息 key', async () => {
    const p = await seedPurchase()
    mockAuthUser({ id: p.user.id, role: 'CUSTOMER' })

    const state = await submitReview(EMPTY_STATE, validForm(p, { rating: '0' }))
    expect(state.fieldErrors?.rating).toBe('ratingRequired')
  })

  it('內容少於 5 個字 → fieldErrors.body（reviewBodyMin），不寫入', async () => {
    const p = await seedPurchase()
    mockAuthUser({ id: p.user.id, role: 'CUSTOMER' })

    const state = await submitReview(EMPTY_STATE, validForm(p, { body: '還行' }))

    expect(state.ok).toBe(false)
    expect(state.fieldErrors?.body).toBe('reviewBodyMin')
    expect(await db.review.count()).toBe(0)
  })

  it('內容超過 2000 字 → fieldErrors.body，不寫入', async () => {
    const p = await seedPurchase()
    mockAuthUser({ id: p.user.id, role: 'CUSTOMER' })

    const state = await submitReview(EMPTY_STATE, validForm(p, { body: '好'.repeat(2001) }))

    expect(state.ok).toBe(false)
    expect(state.fieldErrors?.body).toBeDefined()
    expect(await db.review.count()).toBe(0)
  })

  it('標題超過 100 字 → fieldErrors.title，不寫入', async () => {
    const p = await seedPurchase()
    mockAuthUser({ id: p.user.id, role: 'CUSTOMER' })

    const state = await submitReview(EMPTY_STATE, validForm(p, { title: '標'.repeat(101) }))

    expect(state.ok).toBe(false)
    expect(state.fieldErrors?.title).toBeDefined()
    expect(await db.review.count()).toBe(0)
  })
})

describe('moderateReview：後台審核', () => {
  async function seedPendingReview() {
    const p = await seedPurchase()
    mockAuthUser({ id: p.user.id, role: 'CUSTOMER' })
    await submitReview(EMPTY_STATE, validForm(p))
    const review = await db.review.findUniqueOrThrow({ where: { orderItemId: p.orderItemId } })
    return { ...p, review }
  }

  it('管理員核准 → status APPROVED、記下 moderatedAt、落 AuditLog、revalidate 商品頁', async () => {
    const { review, product } = await seedPendingReview()
    const admin = await createTestUser({ role: 'ADMIN' })
    mockAuthUser({ id: admin.id, role: 'ADMIN' })
    revalidatePathMock.mockClear()

    const result = await moderateReview(review.id, 'APPROVED')

    expect(result).toEqual({ ok: true })
    const fresh = await db.review.findUniqueOrThrow({ where: { id: review.id } })
    expect(fresh.status).toBe('APPROVED')
    expect(fresh.moderatedAt).not.toBeNull()
    expect(fresh.rejectReason).toBeNull()

    const log = await db.auditLog.findFirstOrThrow({ where: { action: 'review.approved' } })
    expect(log.userId).toBe(admin.id)
    expect(log.entity).toBe('Review')
    expect(log.entityId).toBe(review.id)

    expect(revalidatePathMock).toHaveBeenCalledWith('/admin/reviews')
    expect(revalidatePathMock).toHaveBeenCalledWith(`/product/${product.slug}`)
  })

  it('管理員退回並附上理由 → status REJECTED、rejectReason 存下來', async () => {
    const { review } = await seedPendingReview()
    const admin = await createTestUser({ role: 'ADMIN' })
    mockAuthUser({ id: admin.id, role: 'ADMIN' })

    const result = await moderateReview(review.id, 'REJECTED', '內容含有廣告連結')

    expect(result).toEqual({ ok: true })
    const fresh = await db.review.findUniqueOrThrow({ where: { id: review.id } })
    expect(fresh.status).toBe('REJECTED')
    expect(fresh.rejectReason).toBe('內容含有廣告連結')

    await db.auditLog.findFirstOrThrow({ where: { action: 'review.rejected' } })
  })

  it('核准一則先前被退回的評論 → rejectReason 一併清掉', async () => {
    const { review } = await seedPendingReview()
    const admin = await createTestUser({ role: 'ADMIN' })
    mockAuthUser({ id: admin.id, role: 'ADMIN' })

    await moderateReview(review.id, 'REJECTED', '先擋下來')
    await moderateReview(review.id, 'APPROVED')

    const fresh = await db.review.findUniqueOrThrow({ where: { id: review.id } })
    expect(fresh.status).toBe('APPROVED')
    expect(fresh.rejectReason).toBeNull()
  })

  it('未登入或一般會員呼叫審核 → FORBIDDEN，狀態不變、不落 AuditLog', async () => {
    const { review, user } = await seedPendingReview()

    mockAuthUser(null)
    await expect(moderateReview(review.id, 'APPROVED')).rejects.toThrow('FORBIDDEN')

    mockAuthUser({ id: user.id, role: 'CUSTOMER' })
    await expect(moderateReview(review.id, 'APPROVED')).rejects.toThrow('FORBIDDEN')

    const fresh = await db.review.findUniqueOrThrow({ where: { id: review.id } })
    expect(fresh.status).toBe('PENDING')
    expect(await db.auditLog.count()).toBe(0)
  })

  it('評論不存在 → 回 { ok: false }，不會把例外往外丟', async () => {
    const admin = await createTestUser({ role: 'ADMIN' })
    mockAuthUser({ id: admin.id, role: 'ADMIN' })

    const result = await moderateReview('no-such-review', 'APPROVED')

    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
    expect(await db.auditLog.count()).toBe(0)
  })
})

describe('前台可見性', () => {
  it('商品頁只帶出 APPROVED 的評論，PENDING 與 REJECTED 都不出現', async () => {
    const p = await seedPurchase({ variantCount: 3 })
    mockAuthUser({ id: p.user.id, role: 'CUSTOMER' })

    // 同一商品的三個項目，各送一則評論
    const extraItems = await Promise.all(
      [1, 2].map((i) =>
        db.orderItem.create({
          data: {
            orderId: p.orderId,
            variantId: p.variants[i].id,
            productName: '測試商品',
            variantName: p.variants[i].name,
            sku: p.variants[i].sku,
            unitPrice: p.variants[i].price,
            qty: 1,
            lineTotal: p.variants[i].price,
          },
        }),
      ),
    )

    await submitReview(EMPTY_STATE, validForm(p, { body: '這則會被核准，看得到。' }))
    await submitReview(
      EMPTY_STATE,
      validForm(p, { orderItemId: extraItems[0].id, body: '這則還在待審，看不到。' }),
    )
    await submitReview(
      EMPTY_STATE,
      validForm(p, { orderItemId: extraItems[1].id, body: '這則會被退回，看不到。' }),
    )

    const approved = await db.review.findUniqueOrThrow({ where: { orderItemId: p.orderItemId } })
    const rejected = await db.review.findUniqueOrThrow({
      where: { orderItemId: extraItems[1].id },
    })

    const admin = await createTestUser({ role: 'ADMIN' })
    mockAuthUser({ id: admin.id, role: 'ADMIN' })
    await moderateReview(approved.id, 'APPROVED')
    await moderateReview(rejected.id, 'REJECTED', '不符規範')

    const detail = await getProductBySlug(p.product.slug)

    expect(detail).not.toBeNull()
    expect(detail!.reviews).toHaveLength(1)
    expect(detail!.reviews[0].id).toBe(approved.id)
    expect(detail!.reviews[0].body).toBe('這則會被核准，看得到。')
    expect(detail!.reviews.every((r) => r.status === 'APPROVED')).toBe(true)
  })
})
