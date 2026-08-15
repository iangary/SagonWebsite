import { describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { createTestOrder, createTestProduct } from '../factories'

/**
 * 基礎設施 smoke test：真實測試庫可連線、migrate 有跑、
 * TRUNCATE 有效、factories 建得出完整巢狀訂單。
 */
describe('整合測試基礎設施', () => {
  it('連得上測試庫且資料表是空的（TRUNCATE 生效）', async () => {
    expect(await db.order.count()).toBe(0)
    expect(await db.productVariant.count()).toBe(0)
  })

  it('factory 建得出完整訂單（付款/出貨/發票/收據/預扣）', async () => {
    const { order, variant } = await createTestOrder({ qty: 2 })

    expect(order.payment?.merchantTradeNo).toBe(order.orderNo)
    expect(order.payment?.amount).toBe(order.grandTotal)
    expect(order.shipment?.status).toBe('PENDING')
    expect(order.receipt?.status).toBe('PENDING')
    expect(order.reservations).toHaveLength(1)

    const freshVariant = await db.productVariant.findUniqueOrThrow({
      where: { id: variant.id },
    })
    expect(freshVariant.reservedStock).toBe(2)
  })

  it('上一條測試的資料不會留到這一條', async () => {
    expect(await db.order.count()).toBe(0)
  })

  it('商品 factory 支援多變體與草稿狀態', async () => {
    const { product, variants } = await createTestProduct({
      status: 'DRAFT',
      variantCount: 3,
    })
    expect(product.status).toBe('DRAFT')
    expect(product.publishedAt).toBeNull()
    expect(variants).toHaveLength(3)
  })
})
