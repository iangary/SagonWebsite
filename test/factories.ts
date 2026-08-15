import { db } from '@/lib/db'
import type {
  Coupon,
  OrderStatus,
  PaymentStatus,
  Product,
  ProductVariant,
  ShipmentStatus,
  ShippingMethod,
  User,
  UserRole,
} from '@prisma/client'

/**
 * 整合測試資料工廠。全部走真實測試庫（見 test/integration/setup.ts 的
 * TRUNCATE 策略），欄位形狀比照 src/lib/orders/create.ts 實際寫入的樣子。
 */

let seq = 0
function next(): number {
  seq += 1
  return seq
}

/** 產生符合綠界規則的訂單編號（僅英數、<= 20 字） */
export function testOrderNo(): string {
  return `TEST${Date.now().toString(36).toUpperCase()}${next()}`.slice(0, 20)
}

// --- 使用者 -------------------------------------------------------------------

export async function createTestUser(
  overrides: { role?: UserRole; email?: string; phone?: string } = {},
): Promise<User> {
  const n = next()
  return db.user.create({
    data: {
      name: `測試使用者${n}`,
      email: overrides.email ?? `user${n}-${Date.now()}@test.local`,
      phone: overrides.phone,
      role: overrides.role ?? 'CUSTOMER',
    },
  })
}

export async function createTestAdmin(): Promise<User> {
  return createTestUser({ role: 'ADMIN' })
}

// --- 商品 ---------------------------------------------------------------------

export interface TestProductResult {
  product: Product
  variants: ProductVariant[]
}

export async function createTestProduct(
  overrides: {
    status?: Product['status']
    price?: number
    stock?: number
    reservedStock?: number
    /** 要建幾個變體（預設 1 個） */
    variantCount?: number
    name?: string
    isActiveVariant?: boolean
  } = {},
): Promise<TestProductResult> {
  const n = next()
  const price = overrides.price ?? 500
  const variantCount = overrides.variantCount ?? 1

  const product = await db.product.create({
    data: {
      slug: `test-product-${Date.now()}-${n}`,
      name: overrides.name ?? `測試商品${n}`,
      status: overrides.status ?? 'ACTIVE',
      basePrice: price,
      publishedAt: (overrides.status ?? 'ACTIVE') === 'ACTIVE' ? new Date() : null,
      images: {
        create: [{ url: `/uploads/products/test/${n}.webp`, sortOrder: 0 }],
      },
      variants: {
        create: Array.from({ length: variantCount }, (_, i) => ({
          sku: `TEST-SKU-${Date.now()}-${n}-${i}`,
          name: variantCount === 1 ? '單一規格' : `規格${i + 1}`,
          price: price + i * 100,
          stock: overrides.stock ?? 10,
          reservedStock: overrides.reservedStock ?? 0,
          isActive: overrides.isActiveVariant ?? true,
          sortOrder: i,
        })),
      },
    },
  })

  const variants = await db.productVariant.findMany({
    where: { productId: product.id },
    orderBy: { sortOrder: 'asc' },
  })
  return { product, variants }
}

// --- 購物車 -------------------------------------------------------------------

export async function createTestCart(input: {
  userId?: string
  anonId?: string
  couponCode?: string
  items: Array<{ variantId: string; qty: number }>
}) {
  return db.cart.create({
    data: {
      userId: input.userId,
      anonId: input.userId ? undefined : (input.anonId ?? `anon-${Date.now()}-${next()}`),
      couponCode: input.couponCode,
      items: { create: input.items },
    },
    include: { items: true },
  })
}

// --- 優惠券 -------------------------------------------------------------------

export async function createTestCoupon(
  overrides: Partial<{
    code: string
    type: Coupon['type']
    value: number
    minSubtotal: number
    usageLimit: number | null
    perUserLimit: number
    usedCount: number
    isActive: boolean
    startsAt: Date | null
    endsAt: Date | null
  }> = {},
): Promise<Coupon> {
  return db.coupon.create({
    data: {
      code: overrides.code ?? `TESTCOUPON${next()}`,
      type: overrides.type ?? 'FIXED',
      value: overrides.value ?? 100,
      minSubtotal: overrides.minSubtotal ?? 0,
      usageLimit: overrides.usageLimit === undefined ? null : overrides.usageLimit,
      perUserLimit: overrides.perUserLimit ?? 1,
      usedCount: overrides.usedCount ?? 0,
      isActive: overrides.isActive ?? true,
      startsAt: overrides.startsAt ?? null,
      endsAt: overrides.endsAt ?? null,
    },
  })
}

// --- 訂單（含付款/出貨/發票/收據/預扣的完整巢狀結構） -----------------------------

export interface CreateTestOrderInput {
  status?: OrderStatus
  paymentStatus?: PaymentStatus
  choosePayment?: string
  shippingMethod?: ShippingMethod
  shipmentStatus?: ShipmentStatus
  shipmentOverrides?: Record<string, unknown>
  userId?: string
  /** 沒給就自動建一個有庫存的商品 */
  variant?: ProductVariant
  qty?: number
  unitPrice?: number
  shippingFee?: number
  discountTotal?: number
  /** 是否建立未釋放的庫存預扣並同步 reservedStock（預設 true） */
  withReservations?: boolean
  reservationExpiresAt?: Date
  orderNo?: string
}

export async function createTestOrder(input: CreateTestOrderInput = {}) {
  const qty = input.qty ?? 1
  let variant = input.variant
  if (!variant) {
    const created = await createTestProduct({ stock: 10 })
    variant = created.variants[0]
  }

  const unitPrice = input.unitPrice ?? variant.price
  const subtotal = unitPrice * qty
  const shippingFee = input.shippingFee ?? 60
  const discountTotal = input.discountTotal ?? 0
  const grandTotal = subtotal + shippingFee - discountTotal
  const orderNo = input.orderNo ?? testOrderNo()
  const shippingMethod = input.shippingMethod ?? 'CVS'
  const withReservations = input.withReservations ?? true

  const isHome = shippingMethod === 'HOME'
  const order = await db.order.create({
    data: {
      orderNo,
      userId: input.userId,
      email: 'buyer@test.local',
      phone: '0912345678',
      status: input.status ?? 'PENDING_PAYMENT',
      subtotal,
      discountTotal,
      shippingFee,
      grandTotal,
      shippingMethod,
      recipientName: '測試買家',
      recipientPhone: '0912345678',
      addressZip: isHome ? '104' : null,
      addressCity: isHome ? '台北市' : null,
      addressLine: isHome ? '中山區測試路 1 號' : null,
      items: {
        create: [
          {
            variantId: variant.id,
            productName: '測試商品',
            variantName: '單一規格',
            sku: variant.sku,
            unitPrice,
            qty,
            lineTotal: unitPrice * qty,
          },
        ],
      },
      payment: {
        create: {
          merchantTradeNo: orderNo,
          choosePayment: input.choosePayment ?? 'Credit',
          amount: grandTotal,
          status: input.paymentStatus ?? 'PENDING',
        },
      },
      shipment: {
        create: {
          logisticsType: isHome ? 'HOME' : 'CVS',
          logisticsSubType: isHome ? 'TCAT' : 'UNIMARTC2C',
          status: input.shipmentStatus ?? 'PENDING',
          receiverName: '測試買家',
          receiverCell: '0912345678',
          receiverZip: isHome ? '104' : null,
          receiverAddress: isHome ? '台北市中山區測試路 1 號' : null,
          cvsStoreId: isHome ? null : '131386',
          cvsStoreName: isHome ? null : '測試門市',
          cvsAddress: isHome ? null : '台北市中山區南京東路一段 1 號',
          goodsAmount: grandTotal,
          ...(input.shipmentOverrides as object | undefined),
        },
      },
      invoice: { create: { amount: grandTotal } },
      receipt: { create: { amount: grandTotal } },
      ...(withReservations
        ? {
            reservations: {
              create: [
                {
                  variantId: variant.id,
                  qty,
                  expiresAt:
                    input.reservationExpiresAt ?? new Date(Date.now() + 30 * 60 * 1000),
                },
              ],
            },
          }
        : {}),
    },
    include: {
      items: true,
      payment: true,
      shipment: true,
      invoice: true,
      receipt: true,
      reservations: true,
    },
  })

  if (withReservations) {
    await db.productVariant.update({
      where: { id: variant.id },
      data: { reservedStock: { increment: qty } },
    })
  }

  return { order, variant }
}

/** 讀回訂單的最新完整狀態，斷言用 */
export async function reloadOrder(orderId: string) {
  return db.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      payment: true,
      shipment: { include: { logs: true } },
      receipt: true,
      invoice: true,
      reservations: true,
      items: true,
    },
  })
}

export { db }
