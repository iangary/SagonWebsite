import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/queue', async () => (await import('./mocks')).queueMockModule())
vi.mock('@/lib/auth', async () => (await import('./mocks')).authMockModule())
vi.mock('next/headers', async () => (await import('./mocks')).nextHeadersMockModule())
vi.mock('next/cache', async () => (await import('./mocks')).nextCacheMockModule())

import { db } from '@/lib/db'
import { createOrderFromCart, type CreateOrderInput } from '@/lib/orders/create'
import { getCheckoutPrefill, rememberCheckoutDetails } from '@/lib/orders/checkout-prefill'
import { DEFAULT_PAYMENT_SETTINGS } from '@/lib/shop-settings'
import { createTestProduct, createTestUser } from '../factories'
import { mockAuthUser, resetCookieJar } from './mocks'

/**
 * 回購會員的結帳預填：第一次下單填的資料，第二次結帳要自動帶回來。
 * 訂單走真的 createOrderFromCart，預填讀的就是它實際寫進去的形狀。
 */

async function placeOrder(userId: string, input: Partial<CreateOrderInput>) {
  const { variants } = await createTestProduct({ price: 500, stock: 10 })
  // 一個會員只有一台車（userId unique），第二次下單沿用同一台
  const items = { create: [{ variantId: variants[0].id, qty: 1 }] }
  await db.cart.upsert({ where: { userId }, update: { items }, create: { userId, items } })
  const result = await createOrderFromCart({
    email: 'buyer@test.local',
    phone: '0912345678',
    recipientName: '王小明',
    recipientPhone: '0912345678',
    shippingMethod: 'CVS',
    logisticsSubType: 'FAMIC2C',
    cvsStoreId: '006598',
    cvsStoreName: '全家測試店',
    cvsAddress: '台北市中山區南京東路一段 1 號',
    cvsTelephone: '0227112711',
    choosePayment: 'ATM',
    invoice: { isB2B: false },
    ...input,
  })
  if (!result.ok) throw new Error(`預期下單成功，卻失敗：${result.error}`)
  return result
}

async function seedMember(opts: { name?: string; phone?: string } = {}) {
  const user = await createTestUser({ phone: opts.phone })
  if (opts.name !== undefined) {
    await db.user.update({ where: { id: user.id }, data: { name: opts.name } })
  }
  mockAuthUser({ id: user.id, role: 'CUSTOMER', email: user.email })
  return user
}

beforeEach(async () => {
  resetCookieJar()
  mockAuthUser(null)
  // 這支測試用超商取貨 + ATM 下單，兩者預設都是關閉的
  await db.shopSetting.create({ data: { key: 'shipping', value: { cvsEnabled: true } } })
  await db.shopSetting.create({
    data: { key: 'payment', value: { ...DEFAULT_PAYMENT_SETTINGS, methods: { ...DEFAULT_PAYMENT_SETTINGS.methods, ATM: true } } },
  })
})

describe('getCheckoutPrefill', () => {
  it('第一次結帳：沒有訂單也沒有地址，只帶會員名字與信箱', async () => {
    const user = await seedMember({ name: '林小美' })

    const prefill = await getCheckoutPrefill(user.id, null)

    expect(prefill.fromPreviousOrder).toBe(false)
    expect(prefill.recipientName).toBe('林小美')
    expect(prefill.email).toBe(user.email)
    expect(prefill.shippingMethod).toBe('CVS')
    expect(prefill.cvsStore).toBeNull()
    expect(prefill.address).toBeNull()
    expect(prefill.choosePayment).toBeNull()
  })

  it('OTP 自動取的「會員1234」不拿來當收件人', async () => {
    const user = await seedMember({ name: '會員5678' })

    const prefill = await getCheckoutPrefill(user.id, null)

    expect(prefill.recipientName).toBe('')
  })

  it('第二次結帳：帶回上次的收件人、信箱、門市、付款方式', async () => {
    const user = await seedMember()
    await placeOrder(user.id, { email: 'me@test.local' })

    const prefill = await getCheckoutPrefill(user.id, 'session@test.local')

    expect(prefill.fromPreviousOrder).toBe(true)
    expect(prefill.recipientName).toBe('王小明')
    expect(prefill.recipientPhone).toBe('0912345678')
    expect(prefill.email).toBe('me@test.local')
    expect(prefill.shippingMethod).toBe('CVS')
    expect(prefill.cvsSubType).toBe('FAMIC2C')
    expect(prefill.cvsStore).toMatchObject({
      subType: 'FAMIC2C',
      storeId: '006598',
      storeName: '全家測試店',
      collection: false,
    })
    expect(prefill.choosePayment).toBe('ATM')
    expect(prefill.invoiceType).toBe('PERSONAL')
  })

  it('上次開個人發票，仍帶回更早那次的統編與抬頭', async () => {
    const user = await seedMember()
    await placeOrder(user.id, {
      invoice: { isB2B: true, taxId: '12345675', companyName: '莎岡測試有限公司' },
    })
    await placeOrder(user.id, { invoice: { isB2B: false } })

    const prefill = await getCheckoutPrefill(user.id, null)

    expect(prefill.invoiceType).toBe('PERSONAL')
    expect(prefill.taxId).toBe('12345675')
    expect(prefill.companyName).toBe('莎岡測試有限公司')
  })

  it('不會讀到別的會員的訂單', async () => {
    const other = await seedMember()
    await placeOrder(other.id, { recipientName: '別人' })
    const user = await seedMember()

    const prefill = await getCheckoutPrefill(user.id, null)

    expect(prefill.fromPreviousOrder).toBe(false)
    expect(prefill.recipientName).not.toBe('別人')
    expect(prefill.cvsStore).toBeNull()
  })
})

describe('rememberCheckoutDetails', () => {
  const home = { zip: '104', city: '台北市', district: '中山區', line1: '南京東路 1 號' }

  it('宅配地址存進地址簿，第一筆設為預設，下次結帳帶入', async () => {
    const user = await seedMember()

    await rememberCheckoutDetails(user.id, {
      recipientName: '王小明',
      recipientPhone: '0912345678',
      address: home,
    })

    const addresses = await db.address.findMany({ where: { userId: user.id } })
    expect(addresses).toHaveLength(1)
    expect(addresses[0]).toMatchObject({ ...home, recipient: '王小明', isDefault: true })

    const prefill = await getCheckoutPrefill(user.id, null)
    expect(prefill.address).toMatchObject({ ...home, recipient: '王小明' })
  })

  it('同一個地址不重複存；換新地址後帶入最近用的那筆', async () => {
    const user = await seedMember()
    const input = { recipientName: '王小明', recipientPhone: '0912345678' }
    const office = { zip: '110', city: '台北市', district: '信義區', line1: '市府路 1 號' }

    // 「最近用過」靠 updatedAt 排序，隔幾毫秒免得同一毫秒內分不出先後
    const tick = () => new Promise((resolve) => setTimeout(resolve, 5))
    await rememberCheckoutDetails(user.id, { ...input, address: home })
    await tick()
    await rememberCheckoutDetails(user.id, { ...input, address: office })
    await tick()
    await rememberCheckoutDetails(user.id, { ...input, address: home })

    const addresses = await db.address.findMany({ where: { userId: user.id } })
    expect(addresses).toHaveLength(2)
    // 預設地址是會員自己的選擇，結帳不去動它
    expect(addresses.find((a) => a.isDefault)?.line1).toBe(home.line1)

    const prefill = await getCheckoutPrefill(user.id, null)
    expect(prefill.address?.line1).toBe(home.line1)
  })

  it('超商取貨不寫地址簿', async () => {
    const user = await seedMember()

    await rememberCheckoutDetails(user.id, { recipientName: '王小明', recipientPhone: '0912345678' })

    expect(await db.address.count({ where: { userId: user.id } })).toBe(0)
  })

  it('會員名字是空的或「會員1234」才補上收件人姓名，真名不覆蓋', async () => {
    const placeholder = await seedMember({ name: '會員5678' })
    const named = await seedMember({ name: '林小美' })
    const input = { recipientName: '王小明', recipientPhone: '0912345678' }

    await rememberCheckoutDetails(placeholder.id, input)
    await rememberCheckoutDetails(named.id, input)

    const [a, b] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { id: placeholder.id } }),
      db.user.findUniqueOrThrow({ where: { id: named.id } }),
    ])
    expect(a.name).toBe('王小明')
    expect(b.name).toBe('林小美')
  })

  it('不寫回 User.email / User.phone（登入憑證，未經驗證不能改）', async () => {
    const user = await seedMember()

    await rememberCheckoutDetails(user.id, {
      recipientName: '王小明',
      recipientPhone: '0987654321',
      address: home,
    })

    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(after.email).toBe(user.email)
    expect(after.phone).toBe(user.phone)
  })
})
