import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', async () => (await import('./mocks')).authMockModule())
vi.mock('next/cache', async () => (await import('./mocks')).nextCacheMockModule())
vi.mock('next/headers', async () => (await import('./mocks')).nextHeadersMockModule())
vi.mock('next-intl/server', async () => (await import('./mocks')).nextIntlServerMockModule())
vi.mock('@/lib/queue', async () => (await import('./mocks')).queueMockModule())

// 權限應該在任何副作用之前就擋下來；磁碟相關的函式仍然換成 spy，
// 萬一哪天有 action 把 requireAdmin 寫在後面，測試會失敗而不是弄髒檔案系統。
const { saveProductImagesMock, deleteUploadedFileMock, deleteProductImageDirMock } = vi.hoisted(
  () => ({
    saveProductImagesMock: vi.fn(),
    deleteUploadedFileMock: vi.fn(async () => {}),
    deleteProductImageDirMock: vi.fn(async () => {}),
  }),
)

vi.mock('@/lib/uploads', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/uploads')>()
  return {
    ...actual,
    saveProductImages: saveProductImagesMock,
    deleteUploadedFile: deleteUploadedFileMock,
    deleteProductImageDir: deleteProductImageDirMock,
  }
})

import { db } from '@/lib/db'
import * as chatActions from '@/app/admin/chat/actions'
import * as couponsActions from '@/app/admin/coupons/actions'
import * as ordersActions from '@/app/admin/orders/actions'
import * as productsActions from '@/app/admin/products/actions'
import * as reviewsActions from '@/app/admin/reviews/actions'
import * as taxonomyActions from '@/app/admin/taxonomy/actions'
import * as webhooksActions from '@/app/admin/webhooks/actions'
import {
  createTestCoupon,
  createTestOrder,
  createTestProduct,
  createTestUser,
} from '../factories'
import { mockAuthUser, resetCookieJar } from './mocks'
import type { User } from '@prisma/client'

/**
 * 後台權限全面掃描（檢核表 N-01）。
 *
 * 目標很單純：**每一支** admin server action，訪客與一般會員呼叫都必須被擋。
 * 所以這裡不是逐一寫測試，而是列一張表把七個 actions 檔的所有 export 都掃過；
 * 最後一條 meta 測試會反過來檢查「表格有沒有漏掉某支 action」——
 * 新增 action 卻忘了想權限的話，這條會紅。
 *
 * 傳進去的 id 一律是假的：權限檢查在最前面，根本不會走到查資料那一步。
 * 這也順便驗證了「不是因為找不到資料才失敗」。
 */

const EMPTY_FORM_STATE = { ok: false } as const

function formDataFrom(entries: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [key, value] of Object.entries(entries)) fd.append(key, value)
  return fd
}

/** 七個後台 actions 模組，meta 測試用它反查有沒有漏掉的 export */
const ACTION_MODULES: Record<string, Record<string, unknown>> = {
  orders: ordersActions,
  products: productsActions,
  coupons: couponsActions,
  taxonomy: taxonomyActions,
  reviews: reviewsActions,
  webhooks: webhooksActions,
  chat: chatActions,
}

type AdminActionCase = { name: string; run: () => Promise<unknown> }

const ADMIN_ACTIONS: AdminActionCase[] = [
  // --- src/app/admin/orders/actions.ts ---
  { name: 'orders.adminCreateShipment', run: () => ordersActions.adminCreateShipment('order-x') },
  {
    name: 'orders.adminRecordTcatShipment',
    run: () => ordersActions.adminRecordTcatShipment('order-x', 'TCAT12345678'),
  },
  {
    name: 'orders.adminRecordInvoice',
    run: () => ordersActions.adminRecordInvoice('order-x', 'AB12345678'),
  },
  { name: 'orders.adminIssueReceipt', run: () => ordersActions.adminIssueReceipt('order-x') },
  {
    name: 'orders.adminVoidReceipt',
    run: () => ordersActions.adminVoidReceipt('order-x', '客人要求取消'),
  },
  {
    name: 'orders.adminUpdateOrderStatus',
    run: () => ordersActions.adminUpdateOrderStatus('order-x', 'SHIPPED'),
  },
  { name: 'orders.adminCancelOrder', run: () => ordersActions.adminCancelOrder('order-x') },

  // --- src/app/admin/products/actions.ts ---
  {
    name: 'products.createProduct',
    run: () =>
      productsActions.createProduct(
        EMPTY_FORM_STATE,
        formDataFrom({ name: '偷建的商品', price: '100', stock: '1', status: 'DRAFT' }),
      ),
  },
  {
    name: 'products.updateProduct',
    run: () =>
      productsActions.updateProduct(
        EMPTY_FORM_STATE,
        formDataFrom({ id: 'product-x', name: '偷改的商品', status: 'ACTIVE' }),
      ),
  },
  { name: 'products.deleteProduct', run: () => productsActions.deleteProduct('product-x') },
  {
    name: 'products.addVariant',
    run: () =>
      productsActions.addVariant(
        EMPTY_FORM_STATE,
        formDataFrom({ productId: 'product-x', name: '偷加的規格', price: '100', stock: '1' }),
      ),
  },
  {
    name: 'products.updateVariant',
    run: () =>
      productsActions.updateVariant({
        variantId: 'variant-x',
        price: 1,
        stock: 999,
        isActive: true,
      }),
  },
  { name: 'products.deleteVariant', run: () => productsActions.deleteVariant('variant-x') },
  {
    name: 'products.uploadProductImages',
    run: () => {
      const fd = new FormData()
      fd.append('productId', 'product-x')
      fd.append('images', new File(['fake'], 'evil.jpg', { type: 'image/jpeg' }))
      return productsActions.uploadProductImages({ ok: false }, fd)
    },
  },
  {
    name: 'products.deleteProductImage',
    run: () => productsActions.deleteProductImage('image-x'),
  },
  {
    name: 'products.reorderProductImages',
    run: () => productsActions.reorderProductImages('product-x', ['image-x']),
  },
  {
    name: 'products.setProductCategories',
    run: () => productsActions.setProductCategories('product-x', ['category-x']),
  },

  // --- src/app/admin/coupons/actions.ts ---
  {
    name: 'coupons.createCoupon',
    run: () =>
      couponsActions.createCoupon(
        EMPTY_FORM_STATE,
        formDataFrom({
          code: 'HACKED50',
          type: 'PERCENT',
          value: '50',
          minSubtotal: '0',
          perUserLimit: '1',
        }),
      ),
  },
  { name: 'coupons.toggleCoupon', run: () => couponsActions.toggleCoupon('coupon-x', false) },

  // --- src/app/admin/taxonomy/actions.ts ---
  {
    name: 'taxonomy.saveCategory',
    run: () =>
      taxonomyActions.saveCategory(
        EMPTY_FORM_STATE,
        formDataFrom({ name: '偷建的分類', sortOrder: '0' }),
      ),
  },
  { name: 'taxonomy.deleteCategory', run: () => taxonomyActions.deleteCategory('category-x') },
  {
    name: 'taxonomy.saveBrand',
    run: () =>
      taxonomyActions.saveBrand(
        EMPTY_FORM_STATE,
        formDataFrom({ name: '偷建的品牌', sortOrder: '0' }),
      ),
  },
  { name: 'taxonomy.deleteBrand', run: () => taxonomyActions.deleteBrand('brand-x') },

  // --- src/app/admin/reviews/actions.ts ---
  {
    name: 'reviews.moderateReview',
    run: () => reviewsActions.moderateReview('review-x', 'APPROVED'),
  },

  // --- src/app/admin/webhooks/actions.ts ---
  { name: 'webhooks.retryWebhook', run: () => webhooksActions.retryWebhook('event-x') },

  // --- src/app/admin/chat/actions.ts ---
  {
    name: 'chat.replyToConversation',
    run: () =>
      chatActions.replyToConversation({ conversationId: 'conversation-x', body: '假客服回覆' }),
  },
  {
    name: 'chat.updateConversationStatus',
    run: () => chatActions.updateConversationStatus('conversation-x', 'CLOSED'),
  },
]

let customer: User

beforeEach(async () => {
  resetCookieJar()
  vi.clearAllMocks()
  customer = await createTestUser({ role: 'CUSTOMER' })
  mockAuthUser(null)
})

describe('訪客（未登入）呼叫後台 action', () => {
  it.each(ADMIN_ACTIONS)('$name → 拋出 FORBIDDEN', async ({ run }) => {
    mockAuthUser(null)
    await expect(run()).rejects.toThrow('FORBIDDEN')
  })
})

describe('一般會員（CUSTOMER）呼叫後台 action', () => {
  it.each(ADMIN_ACTIONS)('$name → 拋出 FORBIDDEN', async ({ run }) => {
    mockAuthUser({ id: customer.id, role: 'CUSTOMER' })
    await expect(run()).rejects.toThrow('FORBIDDEN')
  })
})

describe('被拒絕的呼叫不留任何痕跡', () => {
  it('掃過全部 action（訪客 + 一般會員）之後：沒有 AuditLog、沒有新資料、沒碰磁碟', async () => {
    for (const identity of [null, { id: customer.id, role: 'CUSTOMER' as const }]) {
      mockAuthUser(identity)
      for (const action of ADMIN_ACTIONS) {
        await expect(action.run()).rejects.toThrow('FORBIDDEN')
      }
    }

    expect(await db.auditLog.count()).toBe(0)
    expect(await db.product.count()).toBe(0)
    expect(await db.productVariant.count()).toBe(0)
    expect(await db.coupon.count()).toBe(0)
    expect(await db.category.count()).toBe(0)
    expect(await db.brand.count()).toBe(0)
    expect(await db.chatMessage.count()).toBe(0)

    expect(saveProductImagesMock).not.toHaveBeenCalled()
    expect(deleteUploadedFileMock).not.toHaveBeenCalled()
    expect(deleteProductImageDirMock).not.toHaveBeenCalled()
  })
})

/**
 * 「被拒絕」本身還不夠 —— 真正要證明的是資料沒有變。
 * 以下四支是破壞性最強的動作，各自帶著真實資料再驗一次。
 */
describe('破壞性動作被拒絕後資料維持原狀', () => {
  const IDENTITIES = [
    { label: '訪客', user: null },
    { label: '一般會員', user: 'customer' as const },
  ]

  function useIdentity(kind: null | 'customer') {
    mockAuthUser(kind === null ? null : { id: customer.id, role: 'CUSTOMER' })
  }

  it.each(IDENTITIES)('$label 刪不掉商品', async ({ user }) => {
    const { product, variants } = await createTestProduct()
    useIdentity(user)

    await expect(productsActions.deleteProduct(product.id)).rejects.toThrow('FORBIDDEN')

    const fresh = await db.product.findUniqueOrThrow({ where: { id: product.id } })
    expect(fresh.status).toBe('ACTIVE') // 沒被封存也沒被刪
    expect(await db.productVariant.count({ where: { id: variants[0].id } })).toBe(1)
    expect(deleteProductImageDirMock).not.toHaveBeenCalled()
  })

  it.each(IDENTITIES)('$label 取消不了訂單（庫存預扣也不會被釋放）', async ({ user }) => {
    const { order, variant } = await createTestOrder({ qty: 2 })
    useIdentity(user)

    await expect(ordersActions.adminCancelOrder(order.id)).rejects.toThrow('FORBIDDEN')

    const fresh = await db.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payment: true, reservations: true },
    })
    expect(fresh.status).toBe('PENDING_PAYMENT')
    expect(fresh.cancelledAt).toBeNull()
    expect(fresh.payment?.status).toBe('PENDING')
    expect(fresh.reservations).toHaveLength(1)

    const freshVariant = await db.productVariant.findUniqueOrThrow({ where: { id: variant.id } })
    expect(freshVariant.reservedStock).toBe(2)
  })

  it.each(IDENTITIES)('$label 停用不了折扣碼', async ({ user }) => {
    // 折扣碼沒有刪除功能，停用（toggleCoupon）就是這裡最具破壞性的動作
    const coupon = await createTestCoupon({ isActive: true })
    useIdentity(user)

    await expect(couponsActions.toggleCoupon(coupon.id, false)).rejects.toThrow('FORBIDDEN')

    const fresh = await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })
    expect(fresh.isActive).toBe(true)
  })

  it.each(IDENTITIES)('$label 刪不掉分類', async ({ user }) => {
    const category = await db.category.create({ data: { slug: 'idor-cat', name: '睡衣' } })
    useIdentity(user)

    await expect(taxonomyActions.deleteCategory(category.id)).rejects.toThrow('FORBIDDEN')

    expect(await db.category.findUnique({ where: { id: category.id } })).not.toBeNull()
  })
})

describe('掃描清單的完整性（meta）', () => {
  it('七個 actions 檔的每一個 export 都在 ADMIN_ACTIONS 表格裡', async () => {
    const exported: string[] = []
    for (const [namespace, actions] of Object.entries(ACTION_MODULES)) {
      for (const [key, value] of Object.entries(actions)) {
        if (typeof value === 'function') exported.push(`${namespace}.${key}`)
      }
    }

    const covered = new Set(ADMIN_ACTIONS.map((a) => a.name))

    // 新增了 action 卻沒補權限測試 → 這裡會列出來
    expect(exported.filter((name) => !covered.has(name))).toEqual([])
    // 反向：表格裡有已經被刪掉／改名的 action
    expect([...covered].filter((name) => !exported.includes(name))).toEqual([])
    // 名稱不能重複，否則 Set 會讓漏測的那支蒙混過關
    expect(new Set(ADMIN_ACTIONS.map((a) => a.name)).size).toBe(ADMIN_ACTIONS.length)
  })

  it('每支 action 都真的被呼叫到（表格不能有假的 run）', async () => {
    // run() 一定要回 Promise，否則 rejects 斷言會靜靜通過
    for (const action of ADMIN_ACTIONS) {
      mockAuthUser(null)
      const result = action.run()
      expect(result, `${action.name} 的 run() 沒有回傳 Promise`).toBeInstanceOf(Promise)
      await expect(result).rejects.toThrow('FORBIDDEN')
    }
  })
})
