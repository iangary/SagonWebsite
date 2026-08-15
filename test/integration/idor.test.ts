import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', async () => (await import('./mocks')).authMockModule())
vi.mock('next/cache', async () => (await import('./mocks')).nextCacheMockModule())
vi.mock('next/headers', async () => (await import('./mocks')).nextHeadersMockModule())
vi.mock('@/lib/queue', async () => (await import('./mocks')).queueMockModule())

/**
 * `@/lib/env` 只有 /api/orders/[orderNo]/amount 的正式環境判斷需要動，
 * 其餘欄位一律穿透到真實的 env（sms/provider 等模組也 import 它）。
 */
const { envOverrides } = vi.hoisted(() => ({ envOverrides: {} as Record<string, unknown> }))

vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/env')>()
  return {
    ...actual,
    env: new Proxy(actual.env, {
      get(target, prop) {
        if (typeof prop === 'string' && prop in envOverrides) return envOverrides[prop]
        return target[prop as keyof typeof target]
      },
    }),
  }
})

/**
 * 頁面層（Server Component）的測試要 import 到 next-intl 的導覽包裝，
 * 它會 `import 'next/navigation'` —— Next 16 的 package.json 沒有這個
 * subpath export，vitest 的 ESM 解析找不到檔案。這兩個 mock 只是把導覽相關
 * 的東西換成不會碰路由的替身，被測的資料查詢邏輯完全是真的。
 */
vi.mock('next/navigation', () => ({
  notFound: () => {
    // 與 Next 的行為一致：丟出可被 404 邊界接住的錯誤
    throw new Error('NEXT_HTTP_ERROR_FALLBACK;404')
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT;${url}`)
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/i18n/routing', async () => {
  const config = await import('@/i18n/config')
  return {
    locales: config.locales,
    routing: {
      locales: config.locales,
      defaultLocale: config.defaultLocale,
      localePrefix: 'as-needed',
    },
    Link: 'a',
    redirect: () => {},
    usePathname: () => '/',
    useRouter: () => ({ push: () => {} }),
    getPathname: () => '/',
  }
})

import { db } from '@/lib/db'
import { CART_COOKIE } from '@/lib/cart'
import { removeCartItem, updateCartItemQty } from '@/lib/cart/actions'
import {
  deleteAddress,
  saveAddress,
  unlinkProvider,
  updateProfile,
} from '@/app/[locale]/account/actions'
import { submitReview } from '@/app/[locale]/account/orders/[id]/review/actions'
import { GET as labelGet } from '@/app/api/admin/labels/[orderId]/route'
import { GET as orderStatusGet } from '@/app/api/orders/[orderNo]/status/route'
import { GET as orderAmountGet } from '@/app/api/orders/[orderNo]/amount/route'
import OrderQueryPage from '@/app/[locale]/order/query/page'
import WriteReviewPage from '@/app/[locale]/account/orders/[id]/review/page'
import { createTestCart, createTestOrder, createTestProduct, createTestUser } from '../factories'
import { MemoryCookieJar, mockAuthUser, resetCookieJar } from './mocks'
import type { User } from '@prisma/client'

/**
 * 跨使用者存取（IDOR）整合測試。
 *
 * 共同的形狀：會員 A 拿著會員 B 的資源 id 呼叫 action ——
 * 這在瀏覽器裡改一個 hidden input 就辦得到，所以每一支「吃 id」的 action
 * 都必須自己帶 ownership 條件，不能只靠前端沒有渲染那個按鈕。
 *
 * 斷言一律兩段：**(1) 被拒絕**、**(2) B 的資料完全沒變** ——
 * 只驗回傳值的話，寫成「先改再檢查」的實作也會過。
 */

const ITEM_NOT_FOUND = '找不到這個項目'

let userA: User
let userB: User
let jar: MemoryCookieJar

beforeEach(async () => {
  jar = resetCookieJar()
  vi.clearAllMocks()
  for (const key of Object.keys(envOverrides)) delete envOverrides[key]

  userA = await createTestUser({ role: 'CUSTOMER' })
  userB = await createTestUser({ role: 'CUSTOMER' })
  mockAuthUser({ id: userA.id, role: 'CUSTOMER' })
})

function loginAs(user: User, role: 'CUSTOMER' | 'ADMIN' = 'CUSTOMER') {
  mockAuthUser({ id: user.id, role })
}

// ---------------------------------------------------------------------------
// 購物車
// ---------------------------------------------------------------------------

describe('購物車：只能動自己車上的項目', () => {
  it('會員 A 改不到會員 B 的購物車項目數量', async () => {
    const { variants } = await createTestProduct({ stock: 10 })
    const cartB = await createTestCart({
      userId: userB.id,
      items: [{ variantId: variants[0].id, qty: 2 }],
    })
    loginAs(userA)

    const result = await updateCartItemQty(cartB.items[0].id, 9)

    expect(result).toEqual({ ok: false, error: ITEM_NOT_FOUND })
    const fresh = await db.cartItem.findUniqueOrThrow({ where: { id: cartB.items[0].id } })
    expect(fresh.qty).toBe(2)
  })

  it('會員 A 刪不掉會員 B 的購物車項目', async () => {
    const { variants } = await createTestProduct()
    const cartB = await createTestCart({
      userId: userB.id,
      items: [{ variantId: variants[0].id, qty: 1 }],
    })
    loginAs(userA)

    const result = await removeCartItem(cartB.items[0].id)

    expect(result).toEqual({ ok: false, error: ITEM_NOT_FOUND })
    expect(await db.cartItem.findUnique({ where: { id: cartB.items[0].id } })).not.toBeNull()
    expect(await db.cartItem.count({ where: { cartId: cartB.id } })).toBe(1)
  })

  it('會員 A 把數量設成 0（等同刪除）也動不了 B 的項目', async () => {
    const { variants } = await createTestProduct()
    const cartB = await createTestCart({
      userId: userB.id,
      items: [{ variantId: variants[0].id, qty: 3 }],
    })
    loginAs(userA)

    expect(await updateCartItemQty(cartB.items[0].id, 0)).toEqual({
      ok: false,
      error: ITEM_NOT_FOUND,
    })
    const fresh = await db.cartItem.findUniqueOrThrow({ where: { id: cartB.items[0].id } })
    expect(fresh.qty).toBe(3)
  })

  it('訪客拿著別的 anonId 的項目 id → 改不動也刪不掉', async () => {
    const { variants } = await createTestProduct({ stock: 10 })
    const cartOther = await createTestCart({
      anonId: 'anon-victim',
      items: [{ variantId: variants[0].id, qty: 2 }],
    })

    // 這位訪客自己的 cookie 是另一組 anonId
    mockAuthUser(null)
    jar.seed(CART_COOKIE, 'anon-attacker')

    expect(await updateCartItemQty(cartOther.items[0].id, 9)).toEqual({
      ok: false,
      error: ITEM_NOT_FOUND,
    })
    expect(await removeCartItem(cartOther.items[0].id)).toEqual({
      ok: false,
      error: ITEM_NOT_FOUND,
    })

    const fresh = await db.cartItem.findUniqueOrThrow({ where: { id: cartOther.items[0].id } })
    expect(fresh.qty).toBe(2)
    expect(await db.cartItem.count({ where: { cartId: cartOther.id } })).toBe(1)
  })

  it('訪客動不了會員的購物車項目', async () => {
    const { variants } = await createTestProduct()
    const cartB = await createTestCart({
      userId: userB.id,
      items: [{ variantId: variants[0].id, qty: 1 }],
    })

    mockAuthUser(null)
    jar.seed(CART_COOKIE, 'anon-attacker')

    expect(await removeCartItem(cartB.items[0].id)).toEqual({ ok: false, error: ITEM_NOT_FOUND })
    expect(await db.cartItem.findUnique({ where: { id: cartB.items[0].id } })).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 評論
// ---------------------------------------------------------------------------

function reviewFormData(input: { orderItemId: string; productId: string }): FormData {
  const fd = new FormData()
  fd.append('orderItemId', input.orderItemId)
  fd.append('productId', input.productId)
  fd.append('rating', '5')
  fd.append('title', '好穿')
  fd.append('body', '這件睡衣非常舒服，值得回購。')
  return fd
}

describe('評論：只能評論自己買過的項目', () => {
  it('會員 A 對會員 B 的 orderItem 送評論 → 被拒且沒有任何 Review 寫入', async () => {
    const { product, variants } = await createTestProduct()
    const { order } = await createTestOrder({
      userId: userB.id,
      variant: variants[0],
      status: 'COMPLETED',
    })
    loginAs(userA)

    const state = await submitReview(
      { ok: false },
      reviewFormData({ orderItemId: order.items[0].id, productId: product.id }),
    )

    expect(state.ok).toBe(false)
    expect(state.error).toBe('找不到對應的購買紀錄，或訂單尚未完成')
    expect(await db.review.count()).toBe(0)
  })

  it('會員 A 用自己的 orderItem 但指定別人的 productId → productMismatch，不寫入', async () => {
    const { variants } = await createTestProduct()
    const other = await createTestProduct()
    const { order } = await createTestOrder({
      userId: userA.id,
      variant: variants[0],
      status: 'COMPLETED',
    })
    loginAs(userA)

    const state = await submitReview(
      { ok: false },
      reviewFormData({ orderItemId: order.items[0].id, productId: other.product.id }),
    )

    expect(state).toMatchObject({ ok: false, error: '商品資料不符' })
    expect(await db.review.count()).toBe(0)
  })

  it('自己的訂單但還沒完成 → 一樣拒絕（避免用未付款訂單灌評論）', async () => {
    const { product, variants } = await createTestProduct()
    const { order } = await createTestOrder({
      userId: userA.id,
      variant: variants[0],
      status: 'PENDING_PAYMENT',
    })
    loginAs(userA)

    const state = await submitReview(
      { ok: false },
      reviewFormData({ orderItemId: order.items[0].id, productId: product.id }),
    )

    expect(state.error).toBe('找不到對應的購買紀錄，或訂單尚未完成')
    expect(await db.review.count()).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 帳號（地址簿 / 個人資料 / 綁定）
// ---------------------------------------------------------------------------

function addressFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData()
  const base: Record<string, string> = {
    recipient: '攻擊者',
    phone: '0987654321',
    zip: '104',
    city: '台北市',
    district: '中山區',
    line1: '南京東路一段 1 號',
    ...overrides,
  }
  for (const [key, value] of Object.entries(base)) fd.append(key, value)
  return fd
}

async function createAddressFor(user: User) {
  return db.address.create({
    data: {
      userId: user.id,
      recipient: '原本的收件人',
      phone: '0912345678',
      zip: '106',
      city: '台北市',
      district: '大安區',
      line1: '和平東路二段 100 號',
      isDefault: true,
    },
  })
}

describe('帳號：地址簿與個人資料只認 session 的 userId', () => {
  it('會員 A 用 B 的地址 id 存檔 → 被拒且 B 的地址一個字都沒變', async () => {
    const addressB = await createAddressFor(userB)
    loginAs(userA)

    await expect(
      saveAddress({ ok: false }, addressFormData({ id: addressB.id })),
    ).rejects.toThrow('address not found')

    const fresh = await db.address.findUniqueOrThrow({ where: { id: addressB.id } })
    expect(fresh).toMatchObject({
      userId: userB.id,
      recipient: '原本的收件人',
      phone: '0912345678',
      line1: '和平東路二段 100 號',
    })
  })

  it('會員 A 存檔時勾「設為預設」，不會把 B 的預設地址取消掉', async () => {
    const addressB = await createAddressFor(userB)
    loginAs(userA)

    // 帶 B 的 id → 整筆交易回滾
    await expect(
      saveAddress({ ok: false }, addressFormData({ id: addressB.id, isDefault: 'on' })),
    ).rejects.toThrow('address not found')

    // 新增自己的預設地址 → 也只影響自己
    const created = await saveAddress({ ok: false }, addressFormData({ isDefault: 'on' }))
    expect(created.ok).toBe(true)

    const freshB = await db.address.findUniqueOrThrow({ where: { id: addressB.id } })
    expect(freshB.isDefault).toBe(true)
    expect(await db.address.count({ where: { userId: userB.id } })).toBe(1)
    expect(await db.address.count({ where: { userId: userA.id } })).toBe(1)
  })

  it('會員 A 刪不掉 B 的地址', async () => {
    const addressB = await createAddressFor(userB)
    loginAs(userA)

    const result = await deleteAddress(addressB.id)

    expect(result).toEqual({ ok: false, error: '找不到這筆地址' })
    expect(await db.address.findUnique({ where: { id: addressB.id } })).not.toBeNull()
  })

  it('訪客呼叫地址簿 action → UNAUTHORIZED', async () => {
    const addressB = await createAddressFor(userB)
    mockAuthUser(null)

    await expect(deleteAddress(addressB.id)).rejects.toThrow('UNAUTHORIZED')
    await expect(saveAddress({ ok: false }, addressFormData())).rejects.toThrow('UNAUTHORIZED')

    expect(await db.address.findUnique({ where: { id: addressB.id } })).not.toBeNull()
    expect(await db.address.count()).toBe(1)
  })

  it('updateProfile 只改得到自己的名字（沒有 userId 參數可以竄改）', async () => {
    loginAs(userA)
    const fd = new FormData()
    fd.append('name', '改過的名字')
    fd.append('userId', userB.id) // 夾帶別人的 id，應該被無視

    const state = await updateProfile({ ok: false }, fd)

    expect(state.ok).toBe(true)
    expect((await db.user.findUniqueOrThrow({ where: { id: userA.id } })).name).toBe('改過的名字')
    expect((await db.user.findUniqueOrThrow({ where: { id: userB.id } })).name).toBe(userB.name)
  })

  it('unlinkProvider 只解得掉自己的綁定，B 的第三方帳號還在', async () => {
    await db.account.create({
      data: {
        userId: userB.id,
        type: 'oauth',
        provider: 'google',
        providerAccountId: 'google-user-b',
      },
    })
    loginAs(userA)

    const result = await unlinkProvider('google')

    expect(result).toEqual({ ok: false, error: '沒有綁定這個登入方式' })
    expect(await db.account.count({ where: { userId: userB.id, provider: 'google' } })).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Route Handlers
// ---------------------------------------------------------------------------

type ParamRoute<P> = (req: Request, ctx: { params: Promise<P> }) => Promise<Response>

const getLabel = labelGet as unknown as ParamRoute<{ orderId: string }>
const getStatus = orderStatusGet as unknown as ParamRoute<{ orderNo: string }>
const getAmount = orderAmountGet as unknown as ParamRoute<{ orderNo: string }>

describe('GET /api/admin/labels/[orderId]：託運單 PDF 只給管理員', () => {
  it('訪客 → 403；一般會員 → 403；管理員 → 通過權限層（檔案不存在時才 404）', async () => {
    // 託運單上有收件人姓名地址電話，proxy.ts 的 matcher 不含 /api，這支必須自己驗身分
    const { order } = await createTestOrder()
    const request = new Request(`http://localhost:3000/api/admin/labels/${order.id}`)
    const ctx = { params: Promise.resolve({ orderId: order.id }) }

    mockAuthUser(null)
    const guest = await getLabel(request, ctx)
    expect(guest.status).toBe(403)
    expect(await guest.json()).toEqual({ error: 'forbidden' })

    loginAs(userA)
    const customer = await getLabel(request, {
      params: Promise.resolve({ orderId: order.id }),
    })
    expect(customer.status).toBe(403)

    // 管理員：權限層放行，因為這張訂單還沒有 labelPath 才回 404
    mockAuthUser({ id: userA.id, role: 'ADMIN' })
    const admin = await getLabel(request, { params: Promise.resolve({ orderId: order.id }) })
    expect(admin.status).toBe(404)
    expect(await admin.json()).toEqual({ error: '這張訂單還沒有託運單檔案' })
  })
})

describe('GET /api/orders/[orderNo]/status：刻意不驗身分，所以不能含個資', () => {
  it('任何人都查得到，但回應只有 status 與 paymentStatus 兩個 key', async () => {
    const { order } = await createTestOrder()
    mockAuthUser(null)

    const res = await getStatus(new Request('http://localhost:3000/api/orders/x/status'), {
      params: Promise.resolve({ orderNo: order.orderNo }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>

    // 這支是結果頁輪詢用的，訂單編號一旦外流就人人可查 ——
    // 因此「回應內容只有狀態列舉」才是它的安全邊界，多回一個欄位就是外洩。
    expect(Object.keys(body).sort()).toEqual(['paymentStatus', 'status'])
    expect(body).toEqual({ status: 'PENDING_PAYMENT', paymentStatus: 'PENDING' })

    const serialized = JSON.stringify(body)
    for (const secret of [
      order.email,
      order.phone,
      order.recipientName,
      order.recipientPhone,
      String(order.grandTotal),
    ]) {
      expect(serialized).not.toContain(secret)
    }
  })

  it('不存在的訂單編號 → 404（不會洩漏「存不存在以外」的資訊）', async () => {
    const res = await getStatus(new Request('http://localhost:3000/api/orders/x/status'), {
      params: Promise.resolve({ orderNo: 'NOSUCHORDER' }),
    })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not found' })
  })
})

describe('GET /api/orders/[orderNo]/amount：正式環境不存在', () => {
  it('非正式環境（測試/開發）回得出金額，供模擬回拋腳本使用', async () => {
    const { order } = await createTestOrder()

    const res = await getAmount(new Request('http://localhost:3000/api/orders/x/amount'), {
      params: Promise.resolve({ orderNo: order.orderNo }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      grandTotal: order.grandTotal,
      status: 'PENDING_PAYMENT',
    })
  })

  it.each([
    { label: 'NODE_ENV=production', overrides: { NODE_ENV: 'production' } },
    { label: 'ECPAY_ENV=production', overrides: { ECPAY_ENV: 'production' } },
  ])('$label → 404，不會變成對外洩漏訂單金額的管道', async ({ overrides }) => {
    const { order } = await createTestOrder()
    Object.assign(envOverrides, overrides)

    const res = await getAmount(new Request('http://localhost:3000/api/orders/x/amount'), {
      params: Promise.resolve({ orderNo: order.orderNo }),
    })

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not found' })
  })
})

// ---------------------------------------------------------------------------
// 頁面層級：訪客訂單查詢的雙因素、會員只看得到自己的訂單
// ---------------------------------------------------------------------------

/**
 * Server Component 回傳的是 React element 樹（沒有真的 render），
 * 這裡只需要知道「有沒有把某張訂單交給 OrderSummaryCard」，
 * 所以往 children 遞迴找帶 order prop 的節點就夠了。
 */
function findRenderedOrder(node: unknown): { orderNo?: string } | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findRenderedOrder(child)
      if (found) return found
    }
    return null
  }
  if (!node || typeof node !== 'object') return null

  const props = (node as { props?: Record<string, unknown> }).props
  if (!props) return null
  if (props.order && typeof props.order === 'object') {
    return props.order as { orderNo?: string }
  }
  return findRenderedOrder(props.children)
}

describe('訪客訂單查詢：訂單編號 + 聯絡方式的雙因素', () => {
  async function query(orderNo: string, contact: string) {
    const element = await OrderQueryPage({
      params: Promise.resolve({ locale: 'zh-TW' }),
      searchParams: Promise.resolve({ orderNo, contact }),
    })
    return findRenderedOrder(element)
  }

  it('編號正確 + 聯絡方式正確 → 查得到；編號正確但聯絡方式錯 → 查不到', async () => {
    const { order } = await createTestOrder()
    mockAuthUser(null)

    const ok = await query(order.orderNo, order.email!)
    expect(ok?.orderNo).toBe(order.orderNo)

    // 只有訂單編號（拿到出貨單就有）不足以看到收件資訊
    expect(await query(order.orderNo, 'someone-else@test.local')).toBeNull()
    expect(await query(order.orderNo, '0900000000')).toBeNull()
    expect(await query('NOSUCHORDER', order.email!)).toBeNull()
  })

  it('手機也算合格的第二因素（下單填的手機或收件人手機）', async () => {
    const { order } = await createTestOrder()
    mockAuthUser(null)

    expect((await query(order.orderNo, '0912345678'))?.orderNo).toBe(order.orderNo)
  })
})

describe('會員訂單頁：A 打不開 B 的訂單', () => {
  it('會員 A 用 B 的訂單 id 開評論頁 → notFound（不是渲染出 B 的訂單）', async () => {
    const { order } = await createTestOrder({ userId: userB.id, status: 'COMPLETED' })
    loginAs(userA)

    const outcome = await WriteReviewPage({ params: Promise.resolve({ id: order.id }) }).then(
      () => 'rendered',
      (error: unknown) => error,
    )

    // 沒有渲染出東西才對 —— 頁面呼叫了 notFound()
    expect(outcome).not.toBe('rendered')
    expect(String(outcome)).toContain('NEXT_HTTP_ERROR_FALLBACK')
  })

  it('會員 B 開自己的訂單 → 正常渲染', async () => {
    const { order } = await createTestOrder({ userId: userB.id, status: 'COMPLETED' })
    loginAs(userB)

    const element = await WriteReviewPage({ params: Promise.resolve({ id: order.id }) })
    expect(element).toBeTruthy()
  })
})
