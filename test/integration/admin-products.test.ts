import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', async () => (await import('./mocks')).authMockModule())
vi.mock('next/cache', async () => (await import('./mocks')).nextCacheMockModule())
vi.mock('next/headers', async () => (await import('./mocks')).nextHeadersMockModule())

// 只 mock 會碰磁碟的函式，MAX_FILES_PER_UPLOAD 等純常數保持真實
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
import {
  addVariant,
  createProduct,
  deleteProduct,
  deleteProductImage,
  deleteVariant,
  reorderProductImages,
  setProductCategories,
  updateProduct,
  updateVariant,
  uploadProductImages,
  type ProductFormState,
  type UploadState,
} from '@/app/admin/products/actions'
import {
  createTestOrder,
  createTestProduct,
  createTestUser,
} from '../factories'
import { mockAuthUser, resetCookieJar, revalidatePathMock } from './mocks'
import type { User } from '@prisma/client'

/**
 * 後台商品管理整合測試：商品/規格/圖片/分類的完整生命週期。
 * requireAdmin 走 mock（但 admin 是真實 User 列，AuditLog 的 FK 才立得住），
 * audit 保持真實並直接斷言 audit_logs 資料列。
 */

const EMPTY_FORM_STATE: ProductFormState = { ok: false }
const EMPTY_UPLOAD_STATE: UploadState = { ok: false }

function formDataFrom(entries: Record<string, string>): FormData {
  const fd = new FormData()
  for (const [key, value] of Object.entries(entries)) fd.append(key, value)
  return fd
}

let admin: User

beforeEach(async () => {
  resetCookieJar()
  revalidatePathMock.mockClear()
  saveProductImagesMock.mockReset()
  deleteUploadedFileMock.mockClear()
  deleteProductImageDirMock.mockClear()

  admin = await createTestUser({ role: 'ADMIN' })
  mockAuthUser({ id: admin.id, role: 'ADMIN' })
})

describe('權限檢查', () => {
  it('未登入 → 代表性動作全部拒絕（FORBIDDEN）', async () => {
    mockAuthUser(null)
    const { product, variants } = await createTestProduct()

    await expect(
      createProduct(EMPTY_FORM_STATE, formDataFrom({ name: 'x', price: '100', stock: '1', status: 'DRAFT' })),
    ).rejects.toThrow('FORBIDDEN')
    await expect(deleteProduct(product.id)).rejects.toThrow('FORBIDDEN')
    await expect(
      updateVariant({ variantId: variants[0].id, price: 100, stock: 1, isActive: true }),
    ).rejects.toThrow('FORBIDDEN')
    await expect(setProductCategories(product.id, [])).rejects.toThrow('FORBIDDEN')

    expect(await db.auditLog.count()).toBe(0)
  })

  it('一般會員（CUSTOMER）→ 一樣拒絕', async () => {
    const customer = await createTestUser({ role: 'CUSTOMER' })
    mockAuthUser({ id: customer.id, role: 'CUSTOMER' })
    const { product } = await createTestProduct()

    await expect(deleteProduct(product.id)).rejects.toThrow('FORBIDDEN')
    await expect(
      createProduct(EMPTY_FORM_STATE, formDataFrom({ name: 'x', price: '100', stock: '1', status: 'DRAFT' })),
    ).rejects.toThrow('FORBIDDEN')
  })
})

describe('createProduct', () => {
  it('建立草稿商品：恰好一個「單一規格」變體、basePrice=變體價、回 redirectTo、落 AuditLog', async () => {
    const state = await createProduct(
      EMPTY_FORM_STATE,
      formDataFrom({ name: '莎岡經典睡衣', price: '790', stock: '12', status: 'DRAFT' }),
    )

    expect(state.ok).toBe(true)
    const product = await db.product.findFirstOrThrow({ include: { variants: true } })
    expect(state.redirectTo).toBe(`/admin/products/${product.id}`)

    expect(product.status).toBe('DRAFT')
    expect(product.publishedAt).toBeNull()
    expect(product.basePrice).toBe(790)
    expect(product.variants).toHaveLength(1)
    expect(product.variants[0].name).toBe('單一規格')
    expect(product.variants[0].price).toBe(790)
    expect(product.variants[0].stock).toBe(12)
    expect(product.variants[0].sku).toMatch(/^SG-/) // 沒指定 SKU 時自動產生

    const log = await db.auditLog.findFirstOrThrow({ where: { action: 'product.create' } })
    expect(log.userId).toBe(admin.id)
    expect(log.entity).toBe('Product')
    expect(log.entityId).toBe(product.id)
  })

  it('slug 撞名 → 自動加 -2 唯一化', async () => {
    const first = await createProduct(
      EMPTY_FORM_STATE,
      formDataFrom({ name: '莎岡經典睡衣', price: '790', stock: '5', status: 'DRAFT' }),
    )
    const second = await createProduct(
      EMPTY_FORM_STATE,
      formDataFrom({ name: '莎岡經典睡衣', price: '890', stock: '5', status: 'DRAFT' }),
    )
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)

    const products = await db.product.findMany({ orderBy: { createdAt: 'asc' } })
    expect(products).toHaveLength(2)
    expect(products[0].slug).toBe('莎岡經典睡衣')
    expect(products[1].slug).toBe('莎岡經典睡衣-2')
  })

  it('指定的 SKU 已被使用 → fieldErrors.sku，不寫入', async () => {
    const { variants } = await createTestProduct()

    const state = await createProduct(
      EMPTY_FORM_STATE,
      formDataFrom({
        name: '撞 SKU 的商品',
        price: '500',
        stock: '1',
        status: 'DRAFT',
        sku: variants[0].sku,
      }),
    )

    expect(state.ok).toBe(false)
    expect(state.fieldErrors?.sku).toBe('這個 SKU 已經被使用')
    expect(await db.product.count()).toBe(1) // 只有 seed 的那筆
  })

  it('zod 驗證失敗（空名稱）→ fieldErrors、完全沒有寫入', async () => {
    const state = await createProduct(
      EMPTY_FORM_STATE,
      formDataFrom({ name: '   ', price: '500', stock: '1', status: 'DRAFT' }),
    )

    expect(state.ok).toBe(false)
    expect(state.fieldErrors?.name).toBe('請輸入商品名稱')
    expect(await db.product.count()).toBe(0)
    expect(await db.auditLog.count()).toBe(0)
  })
})

describe('updateProduct', () => {
  it('更新欄位；DRAFT → ACTIVE 時補上 publishedAt', async () => {
    const { product } = await createTestProduct({ status: 'DRAFT' })
    expect(product.publishedAt).toBeNull()

    const state = await updateProduct(
      EMPTY_FORM_STATE,
      formDataFrom({ id: product.id, name: '改名後的商品', status: 'ACTIVE', summary: '新的摘要' }),
    )

    expect(state).toMatchObject({ ok: true, message: '商品已更新' })
    const fresh = await db.product.findUniqueOrThrow({ where: { id: product.id } })
    expect(fresh.name).toBe('改名後的商品')
    expect(fresh.status).toBe('ACTIVE')
    expect(fresh.summary).toBe('新的摘要')
    expect(fresh.publishedAt).not.toBeNull()

    const log = await db.auditLog.findFirstOrThrow({ where: { action: 'product.update' } })
    expect(log.userId).toBe(admin.id)
    expect(log.entityId).toBe(product.id)
  })

  it('已上架商品再存一次 → publishedAt 維持第一次上架的時間', async () => {
    const { product } = await createTestProduct({ status: 'DRAFT' })

    await updateProduct(
      EMPTY_FORM_STATE,
      formDataFrom({ id: product.id, name: '商品', status: 'ACTIVE' }),
    )
    const first = await db.product.findUniqueOrThrow({ where: { id: product.id } })

    await new Promise((resolve) => setTimeout(resolve, 15))
    await updateProduct(
      EMPTY_FORM_STATE,
      formDataFrom({ id: product.id, name: '商品', status: 'ACTIVE' }),
    )
    const second = await db.product.findUniqueOrThrow({ where: { id: product.id } })

    // publishedAt 是前台「最新上架」的排序依據。每次存檔都重蓋的話，
    // 改個錯字就會讓半年前的商品跳到新品第一位。
    expect(second.publishedAt!.getTime()).toBe(first.publishedAt!.getTime())
  })

  it('英文名稱與商品描述可以在編輯頁改，也可以清空', async () => {
    const { product } = await createTestProduct({ status: 'DRAFT' })

    await updateProduct(
      EMPTY_FORM_STATE,
      formDataFrom({
        id: product.id,
        name: '睡衣',
        status: 'DRAFT',
        nameEn: 'Pajama Set',
        descriptionHtml: '<p>材質：100% 純棉</p>',
      }),
    )
    const filled = await db.product.findUniqueOrThrow({ where: { id: product.id } })
    expect(filled.nameEn).toBe('Pajama Set')
    expect(filled.descriptionHtml).toBe('<p>材質：100% 純棉</p>')

    // 留白要真的清成 null，否則英文站會一直吃到舊翻譯
    await updateProduct(
      EMPTY_FORM_STATE,
      formDataFrom({ id: product.id, name: '睡衣', status: 'DRAFT' }),
    )
    const cleared = await db.product.findUniqueOrThrow({ where: { id: product.id } })
    expect(cleared.nameEn).toBeNull()
    expect(cleared.descriptionHtml).toBeNull()
  })

  it('原價要高於售價才收，不合格回 fieldErrors 而不是靜靜丟掉', async () => {
    const { product } = await createTestProduct({ status: 'DRAFT' })
    const { basePrice } = await db.product.findUniqueOrThrow({
      where: { id: product.id },
      select: { basePrice: true },
    })

    const tooLow = await updateProduct(
      EMPTY_FORM_STATE,
      formDataFrom({
        id: product.id,
        name: '睡衣',
        status: 'DRAFT',
        compareAtPrice: String(basePrice),
      }),
    )
    expect(tooLow.ok).toBe(false)
    expect(tooLow.fieldErrors?.compareAtPrice).toContain(String(basePrice))

    const ok = await updateProduct(
      EMPTY_FORM_STATE,
      formDataFrom({
        id: product.id,
        name: '睡衣',
        status: 'DRAFT',
        compareAtPrice: String(basePrice + 500),
      }),
    )
    expect(ok.ok).toBe(true)
    const fresh = await db.product.findUniqueOrThrow({ where: { id: product.id } })
    expect(fresh.compareAtPrice).toBe(basePrice + 500)
  })
})

describe('updateVariant', () => {
  it('更新 price/stock/isActive 並落 AuditLog', async () => {
    const { variants } = await createTestProduct({ price: 500, stock: 10 })

    const result = await updateVariant({
      variantId: variants[0].id,
      price: 650,
      stock: 8,
      isActive: false,
    })

    expect(result).toEqual({ ok: true })
    const fresh = await db.productVariant.findUniqueOrThrow({ where: { id: variants[0].id } })
    expect(fresh.price).toBe(650)
    expect(fresh.stock).toBe(8)
    expect(fresh.isActive).toBe(false)

    const log = await db.auditLog.findFirstOrThrow({ where: { action: 'variant.update' } })
    expect(log.userId).toBe(admin.id)
    expect(log.entity).toBe('ProductVariant')
    expect(log.entityId).toBe(variants[0].id)
  })

  it('庫存調到低於已被訂單佔用的預扣量 → 拒絕', async () => {
    const { variants } = await createTestProduct({ stock: 10 })
    await createTestOrder({ variant: variants[0], qty: 3 }) // reservedStock +3

    const result = await updateVariant({
      variantId: variants[0].id,
      price: 500,
      stock: 2,
      isActive: true,
    })

    expect(result).toEqual({
      ok: false,
      error: '已有 3 件被未付款訂單佔用，庫存不能低於這個數字',
    })
    const fresh = await db.productVariant.findUniqueOrThrow({ where: { id: variants[0].id } })
    expect(fresh.stock).toBe(10)
  })

  it('basePrice 同步為最便宜的啟用變體：改價會重算、停用最便宜的也會重算', async () => {
    // 兩個變體：500 與 600
    const { product, variants } = await createTestProduct({ price: 500, variantCount: 2 })

    // 把第二個變體降到 300 → basePrice 跟著變 300
    await updateVariant({ variantId: variants[1].id, price: 300, stock: 10, isActive: true })
    let fresh = await db.product.findUniqueOrThrow({ where: { id: product.id } })
    expect(fresh.basePrice).toBe(300)

    // 停用最便宜的變體 → basePrice 回到 500
    await updateVariant({ variantId: variants[1].id, price: 300, stock: 10, isActive: false })
    fresh = await db.product.findUniqueOrThrow({ where: { id: product.id } })
    expect(fresh.basePrice).toBe(500)
  })
})

describe('addVariant', () => {
  it('新增規格：sortOrder 接續、加了更便宜的規格後 basePrice 重算', async () => {
    const { product } = await createTestProduct({ price: 500 })

    const state = await addVariant(
      EMPTY_FORM_STATE,
      formDataFrom({ productId: product.id, name: '加大版', price: '300', stock: '5' }),
    )

    expect(state.ok).toBe(true)
    expect(state.message).toBe('規格「加大版」已新增')

    const variant = await db.productVariant.findFirstOrThrow({
      where: { productId: product.id, name: '加大版' },
    })
    expect(variant.sortOrder).toBe(1)
    expect(variant.options).toEqual({ 規格: '加大版' })

    const fresh = await db.product.findUniqueOrThrow({ where: { id: product.id } })
    expect(fresh.basePrice).toBe(300)
  })

  it('SKU 已被使用或規格名稱重複 → fieldErrors', async () => {
    const { product, variants } = await createTestProduct()

    const skuTaken = await addVariant(
      EMPTY_FORM_STATE,
      formDataFrom({
        productId: product.id,
        name: '新規格',
        sku: variants[0].sku,
        price: '100',
        stock: '1',
      }),
    )
    expect(skuTaken.ok).toBe(false)
    expect(skuTaken.fieldErrors?.sku).toBe('這個 SKU 已經被使用')

    const nameTaken = await addVariant(
      EMPTY_FORM_STATE,
      formDataFrom({ productId: product.id, name: '單一規格', price: '100', stock: '1' }),
    )
    expect(nameTaken.ok).toBe(false)
    expect(nameTaken.fieldErrors?.name).toBe('這個規格名稱已經存在')

    expect(await db.productVariant.count({ where: { productId: product.id } })).toBe(1)
  })
})

describe('deleteVariant', () => {
  it('最後一個規格不能刪', async () => {
    const { variants } = await createTestProduct()

    const result = await deleteVariant(variants[0].id)

    expect(result).toEqual({
      ok: false,
      error: '商品至少要保留一個規格，請改用「停用」或直接封存商品',
    })
    expect(await db.productVariant.findUnique({ where: { id: variants[0].id } })).not.toBeNull()
  })

  it('賣過的規格 → 停用而不是刪除', async () => {
    const { variants } = await createTestProduct({ variantCount: 2 })
    // 有銷售紀錄但預扣已釋放
    await createTestOrder({ variant: variants[0], withReservations: false })

    const result = await deleteVariant(variants[0].id)

    expect(result.ok).toBe(true)
    expect(result.message).toContain('已改為停用')
    const fresh = await db.productVariant.findUniqueOrThrow({ where: { id: variants[0].id } })
    expect(fresh.isActive).toBe(false)

    const log = await db.auditLog.findFirstOrThrow({ where: { action: 'variant.deactivate' } })
    expect(log.entityId).toBe(variants[0].id)
  })

  it('沒賣過的規格 → 硬刪，且 basePrice 重算', async () => {
    // 變體 500 / 600，刪掉 500 的之後 basePrice 應變 600
    const { product, variants } = await createTestProduct({ price: 500, variantCount: 2 })

    const result = await deleteVariant(variants[0].id)

    expect(result.ok).toBe(true)
    expect(await db.productVariant.findUnique({ where: { id: variants[0].id } })).toBeNull()

    const fresh = await db.product.findUniqueOrThrow({ where: { id: product.id } })
    expect(fresh.basePrice).toBe(600)

    const log = await db.auditLog.findFirstOrThrow({ where: { action: 'variant.delete' } })
    expect(log.entityId).toBe(variants[0].id)
  })

  it('仍有未付款訂單佔用（reservedStock > 0）→ 拒絕', async () => {
    const { variants } = await createTestProduct({ variantCount: 2 })
    await createTestOrder({ variant: variants[0], qty: 1 }) // 預扣未釋放

    const result = await deleteVariant(variants[0].id)

    expect(result).toEqual({
      ok: false,
      error: '仍有未付款訂單佔用這個規格，請等訂單結束後再刪除',
    })
  })
})

describe('deleteProduct', () => {
  it('賣過的商品 → 封存（ARCHIVED）而不是刪除', async () => {
    const { product, variants } = await createTestProduct()
    await createTestOrder({ variant: variants[0], withReservations: false })

    const result = await deleteProduct(product.id)

    expect(result.ok).toBe(true)
    expect(result.message).toContain('已改為封存而非刪除')
    const fresh = await db.product.findUniqueOrThrow({ where: { id: product.id } })
    expect(fresh.status).toBe('ARCHIVED')

    const log = await db.auditLog.findFirstOrThrow({ where: { action: 'product.archive' } })
    expect(log.entityId).toBe(product.id)
    expect(deleteProductImageDirMock).not.toHaveBeenCalled()
  })

  it('有未釋放的庫存預扣 → 拒絕刪除', async () => {
    const { product } = await createTestProduct({ reservedStock: 2 })

    const result = await deleteProduct(product.id)

    expect(result).toEqual({
      ok: false,
      error: '仍有未付款訂單佔用庫存，請等訂單結束後再刪除',
    })
    expect(await db.product.findUnique({ where: { id: product.id } })).not.toBeNull()
  })

  it('全新沒賣過的商品 → 硬刪 + 清除圖片目錄 + 落 AuditLog', async () => {
    const { product } = await createTestProduct()

    const result = await deleteProduct(product.id)

    expect(result.ok).toBe(true)
    expect(await db.product.findUnique({ where: { id: product.id } })).toBeNull()
    expect(deleteProductImageDirMock).toHaveBeenCalledWith(product.id)

    const log = await db.auditLog.findFirstOrThrow({ where: { action: 'product.delete' } })
    expect(log.userId).toBe(admin.id)
    expect(log.entityId).toBe(product.id)
  })
})

describe('uploadProductImages', () => {
  function uploadFormData(productId: string, fileCount: number): FormData {
    const fd = new FormData()
    fd.append('productId', productId)
    for (let i = 0; i < fileCount; i++) {
      fd.append('images', new File([`fake-image-${i}`], `photo-${i}.jpg`, { type: 'image/jpeg' }))
    }
    return fd
  }

  it('一次超過上限張數 → 拒絕，不會碰到磁碟', async () => {
    const { product } = await createTestProduct()

    const state = await uploadProductImages(EMPTY_UPLOAD_STATE, uploadFormData(product.id, 11))

    expect(state).toEqual({ ok: false, error: '一次最多上傳 10 張' })
    expect(saveProductImagesMock).not.toHaveBeenCalled()
  })

  it('上傳成功：sortOrder 接在既有圖片之後、alt 用商品名、落 AuditLog', async () => {
    const { product } = await createTestProduct() // factory 已建 1 張 sortOrder 0
    saveProductImagesMock.mockResolvedValue({
      saved: [
        { url: `/uploads/products/${product.id}/a.webp`, width: 800, height: 600, bytes: 1000 },
        { url: `/uploads/products/${product.id}/b.webp`, width: 800, height: 600, bytes: 1200 },
      ],
      failed: [],
    })

    const state = await uploadProductImages(EMPTY_UPLOAD_STATE, uploadFormData(product.id, 2))

    expect(state.ok).toBe(true)
    expect(state.message).toBe('已上傳 2 張圖片')

    const images = await db.productImage.findMany({
      where: { productId: product.id },
      orderBy: { sortOrder: 'asc' },
    })
    expect(images).toHaveLength(3)
    expect(images[1].url).toBe(`/uploads/products/${product.id}/a.webp`)
    expect(images[1].sortOrder).toBe(1)
    expect(images[1].alt).toBe(product.name)
    expect(images[2].sortOrder).toBe(2)

    const log = await db.auditLog.findFirstOrThrow({ where: { action: 'product.images.upload' } })
    expect(log.entityId).toBe(product.id)
  })
})

describe('deleteProductImage', () => {
  it('刪除資料列並呼叫檔案刪除；不存在的 id → 拒絕', async () => {
    const { product } = await createTestProduct()
    const image = await db.productImage.findFirstOrThrow({ where: { productId: product.id } })

    const result = await deleteProductImage(image.id)

    expect(result).toEqual({ ok: true })
    expect(await db.productImage.findUnique({ where: { id: image.id } })).toBeNull()
    expect(deleteUploadedFileMock).toHaveBeenCalledWith(image.url)

    const log = await db.auditLog.findFirstOrThrow({ where: { action: 'product.images.delete' } })
    expect(log.entityId).toBe(product.id)

    // 不存在（或已刪除）的 id
    expect(await deleteProductImage(image.id)).toEqual({ ok: false, error: '找不到這張圖片' })
  })
})

describe('reorderProductImages', () => {
  async function seedImages(productId: string, count: number): Promise<string[]> {
    await db.productImage.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        productId,
        url: `/uploads/products/${productId}/extra-${i}.webp`,
        sortOrder: i + 1,
      })),
    })
    const images = await db.productImage.findMany({
      where: { productId },
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
    })
    return images.map((i) => i.id)
  }

  it('id 集合必須與商品現有圖片完全一致：缺一個、多一個、夾帶別商品的都拒絕', async () => {
    const { product } = await createTestProduct()
    const ids = await seedImages(product.id, 2) // 共 3 張
    const other = await createTestProduct()
    const otherImage = await db.productImage.findFirstOrThrow({
      where: { productId: other.product.id },
    })

    // 缺一個
    expect(await reorderProductImages(product.id, ids.slice(0, 2))).toEqual({
      ok: false,
      error: '圖片清單不一致，請重新載入頁面',
    })
    // 多一個（不存在的 id）
    expect(await reorderProductImages(product.id, [...ids, 'nonexistent-id'])).toEqual({
      ok: false,
      error: '圖片清單不一致，請重新載入頁面',
    })
    // 數量對但夾帶別商品的圖
    expect(
      await reorderProductImages(product.id, [ids[0], ids[1], otherImage.id]),
    ).toEqual({ ok: false, error: '圖片清單不一致，請重新載入頁面' })

    // 全部被拒絕：排序不變
    const fresh = await db.productImage.findMany({
      where: { productId: product.id },
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
    })
    expect(fresh.map((i) => i.id)).toEqual(ids)
  })

  it('完整的 id 順序 → 依新順序重寫 sortOrder', async () => {
    const { product } = await createTestProduct()
    const ids = await seedImages(product.id, 2)
    const reversed = [...ids].reverse()

    const result = await reorderProductImages(product.id, reversed)

    expect(result).toEqual({ ok: true })
    const images = await db.productImage.findMany({
      where: { productId: product.id },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, sortOrder: true },
    })
    expect(images.map((i) => i.id)).toEqual(reversed)
    expect(images.map((i) => i.sortOrder)).toEqual([0, 1, 2])

    const log = await db.auditLog.findFirstOrThrow({ where: { action: 'product.images.reorder' } })
    expect(log.entityId).toBe(product.id)
  })
})

describe('setProductCategories', () => {
  it('整批替換分類、revalidate /admin/taxonomy、落 AuditLog', async () => {
    const { product } = await createTestProduct()
    const [c1, c2, c3] = await Promise.all(
      ['分類一', '分類二', '分類三'].map((name, i) =>
        db.category.create({ data: { slug: `cat-${i + 1}`, name } }),
      ),
    )

    // 第一次設定
    expect(await setProductCategories(product.id, [c1.id, c2.id])).toEqual({ ok: true })
    let rows = await db.productCategory.findMany({ where: { productId: product.id } })
    expect(rows.map((r) => r.categoryId).sort()).toEqual([c1.id, c2.id].sort())

    // 整批替換成另一組
    revalidatePathMock.mockClear()
    expect(await setProductCategories(product.id, [c3.id])).toEqual({ ok: true })
    rows = await db.productCategory.findMany({ where: { productId: product.id } })
    expect(rows.map((r) => r.categoryId)).toEqual([c3.id])

    // 近期修復：分類頁的商品數快取也要失效
    expect(revalidatePathMock).toHaveBeenCalledWith('/admin/taxonomy')

    const logs = await db.auditLog.findMany({
      where: { action: 'product.categories.set' },
      orderBy: { createdAt: 'asc' },
    })
    expect(logs).toHaveLength(2)
    expect(logs[1].userId).toBe(admin.id)
    expect(logs[1].entity).toBe('Product')
    expect(logs[1].before).toEqual({ categoryIds: expect.arrayContaining([c1.id, c2.id]) })
    expect(logs[1].after).toEqual({ categoryIds: [c3.id] })
  })

  it('清空分類（空陣列）→ 全部移除', async () => {
    const { product } = await createTestProduct()
    const cat = await db.category.create({ data: { slug: 'cat-clear', name: '待清空' } })
    await db.productCategory.create({ data: { productId: product.id, categoryId: cat.id } })

    expect(await setProductCategories(product.id, [])).toEqual({ ok: true })
    expect(await db.productCategory.count({ where: { productId: product.id } })).toBe(0)
  })
})
