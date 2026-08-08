'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { uniqueSku, uniqueSlug } from '@/lib/catalog/slug'
import {
  deleteProductImageDir,
  deleteUploadedFile,
  saveProductImages,
  MAX_FILES_PER_UPLOAD,
} from '@/lib/uploads'

export type ProductFormState = {
  ok: boolean
  message?: string
  error?: string
  fieldErrors?: Record<string, string>
  /** 新增成功後前端要導向的網址 */
  redirectTo?: string
}

function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) out[String(issue.path[0] ?? '_')] ??= issue.message
  return out
}

/** 商品的 basePrice 是列表頁顯示用的快取欄位，等於最低的啟用規格售價。 */
async function syncBasePrice(productId: string): Promise<void> {
  const cheapest = await db.productVariant.findFirst({
    where: { productId, isActive: true },
    orderBy: { price: 'asc' },
    select: { price: true },
  })
  if (cheapest) {
    await db.product.update({ where: { id: productId }, data: { basePrice: cheapest.price } })
  }
}

/** 改完商品後要讓前台的快取失效 */
async function revalidateProduct(productId: string): Promise<void> {
  const product = await db.product.findUnique({
    where: { id: productId },
    select: { slug: true },
  })
  revalidatePath('/admin/products')
  revalidatePath(`/admin/products/${productId}`)
  if (product) revalidatePath(`/product/${product.slug}`)
}

const productSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, '請輸入商品名稱').max(200),
  summary: z.string().trim().max(500).optional().default(''),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']),
  brandId: z.string().optional().default(''),
  seoTitle: z.string().trim().max(200).optional().default(''),
  seoDescription: z.string().trim().max(300).optional().default(''),
})

export async function updateProduct(
  _prev: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const admin = await requireAdmin()

  const parsed = productSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0] ?? '_')] ??= issue.message
    }
    return { ok: false, fieldErrors }
  }

  const { id, ...data } = parsed.data

  try {
    const before = await db.product.findUniqueOrThrow({
      where: { id },
      select: { name: true, status: true, brandId: true, summary: true },
    })

    await db.product.update({
      where: { id },
      data: {
        name: data.name,
        summary: data.summary || null,
        status: data.status,
        brandId: data.brandId || null,
        seoTitle: data.seoTitle || null,
        seoDescription: data.seoDescription || null,
        // 從草稿轉上架時補上上架時間
        ...(data.status === 'ACTIVE' ? { publishedAt: new Date() } : {}),
      },
    })

    await audit({
      userId: admin.id,
      action: 'product.update',
      entity: 'Product',
      entityId: id,
      before,
      after: data,
    })

    revalidatePath('/admin/products')
    revalidatePath(`/admin/products/${id}`)
    return { ok: true, message: '商品已更新' }
  } catch (error) {
    console.error('[admin] 更新商品失敗', error)
    return { ok: false, error: (error as Error).message }
  }
}

const variantSchema = z.object({
  variantId: z.string().min(1),
  price: z.coerce.number().int().min(0).max(9_999_999),
  stock: z.coerce.number().int().min(0).max(999_999),
  isActive: z.boolean(),
})

export async function updateVariant(input: {
  variantId: string
  price: number
  stock: number
  isActive: boolean
}): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin()

  const parsed = variantSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: '欄位格式不正確' }

  try {
    const before = await db.productVariant.findUniqueOrThrow({
      where: { id: parsed.data.variantId },
      select: { price: true, stock: true, isActive: true, productId: true, reservedStock: true },
    })

    // 庫存不能調到比已經被訂單佔住的還少，否則會出現負的可售量
    if (parsed.data.stock < before.reservedStock) {
      return {
        ok: false,
        error: `已有 ${before.reservedStock} 件被未付款訂單佔用，庫存不能低於這個數字`,
      }
    }

    await db.productVariant.update({
      where: { id: parsed.data.variantId },
      data: {
        price: parsed.data.price,
        stock: parsed.data.stock,
        isActive: parsed.data.isActive,
      },
    })

    await syncBasePrice(before.productId)

    await audit({
      userId: admin.id,
      action: 'variant.update',
      entity: 'ProductVariant',
      entityId: parsed.data.variantId,
      before,
      after: parsed.data,
    })

    revalidatePath(`/admin/products/${before.productId}`)
    return { ok: true }
  } catch (error) {
    console.error('[admin] 更新規格失敗', error)
    return { ok: false, error: (error as Error).message }
  }
}

// ---------------------------------------------------------------------------
// 新增商品
// ---------------------------------------------------------------------------

const createSchema = z.object({
  name: z.string().trim().min(1, '請輸入商品名稱').max(200),
  brandId: z.string().optional().default(''),
  summary: z.string().trim().max(500).optional().default(''),
  descriptionHtml: z.string().trim().max(100_000).optional().default(''),
  price: z.coerce.number().int().min(0, '售價不能小於 0').max(9_999_999),
  compareAtPrice: z.string().optional().default(''),
  stock: z.coerce.number().int().min(0).max(999_999),
  sku: z.string().trim().max(64).optional().default(''),
  variantName: z.string().trim().max(60).optional().default(''),
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']),
  categoryIds: z.string().optional().default(''), // 逗號分隔
})

/**
 * 新增商品，同時建立第一個規格。
 *
 * 一定要有規格，因為購物車與訂單都指向規格而不是商品；
 * 沒指定規格名稱就叫「單一規格」，跟 seed 的慣例一致。
 * 預設狀態給草稿，讓營運可以先建好、上傳圖片、確認無誤後才上架。
 */
export async function createProduct(
  _prev: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const admin = await requireAdmin()

  const parsed = createSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) }

  const data = parsed.data

  // 原價要比售價高才有意義，否則不顯示刪除線價格
  const compareAt = data.compareAtPrice ? Number.parseInt(data.compareAtPrice, 10) : null
  const compareAtPrice = compareAt && compareAt > data.price ? compareAt : null

  try {
    let sku = data.sku
    if (sku) {
      const taken = await db.productVariant.findUnique({ where: { sku }, select: { id: true } })
      if (taken) return { ok: false, fieldErrors: { sku: '這個 SKU 已經被使用' } }
    } else {
      sku = await uniqueSku()
    }

    const slug = await uniqueSlug('product', data.name, 'product')
    const categoryIds = data.categoryIds.split(',').filter(Boolean)

    const product = await db.product.create({
      data: {
        slug,
        name: data.name,
        summary: data.summary || null,
        descriptionHtml: data.descriptionHtml || null,
        brandId: data.brandId || null,
        status: data.status,
        basePrice: data.price,
        compareAtPrice,
        publishedAt: data.status === 'ACTIVE' ? new Date() : null,
        seoTitle: data.name,
        seoDescription: data.summary?.slice(0, 155) || null,
        variants: {
          create: {
            sku,
            name: data.variantName || '單一規格',
            options: data.variantName ? { 規格: data.variantName } : {},
            price: data.price,
            compareAtPrice,
            stock: data.stock,
            sortOrder: 0,
          },
        },
        ...(categoryIds.length > 0
          ? { categories: { create: categoryIds.map((categoryId) => ({ categoryId })) } }
          : {}),
      },
    })

    await audit({
      userId: admin.id,
      action: 'product.create',
      entity: 'Product',
      entityId: product.id,
      after: { name: product.name, slug, sku, status: data.status },
    })

    revalidatePath('/admin/products')
    return {
      ok: true,
      message: `「${product.name}」已建立`,
      redirectTo: `/admin/products/${product.id}`,
    }
  } catch (error) {
    console.error('[admin] 新增商品失敗', error)
    return { ok: false, error: (error as Error).message }
  }
}

/**
 * 刪除商品。
 *
 * 賣過的商品**不能真的刪掉** —— 歷史訂單雖然存了商品快照，
 * 但把資料列刪掉會讓評論與訂單失去關聯，對帳與客訴都查不回來。
 * 這種情況改成封存（前台看不到，資料留著）。
 * 從沒賣過的（例如建錯的）才允許真刪，並一併清掉磁碟上的圖片。
 */
export async function deleteProduct(
  productId: string,
): Promise<{ ok: boolean; message?: string; error?: string }> {
  const admin = await requireAdmin()

  try {
    const product = await db.product.findUnique({
      where: { id: productId },
      select: {
        name: true,
        slug: true,
        variants: { select: { id: true, reservedStock: true } },
      },
    })
    if (!product) return { ok: false, error: '找不到這個商品' }

    const variantIds = product.variants.map((v) => v.id)

    const orderedCount = await db.orderItem.count({
      where: { variantId: { in: variantIds } },
    })

    if (orderedCount > 0) {
      await db.product.update({ where: { id: productId }, data: { status: 'ARCHIVED' } })
      await audit({
        userId: admin.id,
        action: 'product.archive',
        entity: 'Product',
        entityId: productId,
        before: { name: product.name },
      })
      revalidatePath('/admin/products')
      revalidatePath(`/product/${product.slug}`)
      return {
        ok: true,
        message: `「${product.name}」已有 ${orderedCount} 筆銷售紀錄，已改為封存而非刪除`,
      }
    }

    // 還有未付款訂單佔著庫存的話，刪掉會讓那張訂單的預扣孤立
    if (product.variants.some((v) => v.reservedStock > 0)) {
      return { ok: false, error: '仍有未付款訂單佔用庫存，請等訂單結束後再刪除' }
    }

    await db.product.delete({ where: { id: productId } })
    // 整個資料夾一起移除，不要留下空目錄
    await deleteProductImageDir(productId)

    await audit({
      userId: admin.id,
      action: 'product.delete',
      entity: 'Product',
      entityId: productId,
      before: { name: product.name, slug: product.slug },
    })

    revalidatePath('/admin/products')
    return { ok: true, message: `「${product.name}」已刪除` }
  } catch (error) {
    console.error('[admin] 刪除商品失敗', error)
    return { ok: false, error: (error as Error).message }
  }
}

// ---------------------------------------------------------------------------
// 規格增刪
// ---------------------------------------------------------------------------

const addVariantSchema = z.object({
  productId: z.string().min(1),
  name: z.string().trim().min(1, '請輸入規格名稱').max(60),
  sku: z.string().trim().max(64).optional().default(''),
  price: z.coerce.number().int().min(0).max(9_999_999),
  stock: z.coerce.number().int().min(0).max(999_999),
})

export async function addVariant(
  _prev: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const admin = await requireAdmin()

  const parsed = addVariantSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) }

  const data = parsed.data

  try {
    const existing = await db.productVariant.findFirst({
      where: { productId: data.productId, name: data.name },
      select: { id: true },
    })
    if (existing) return { ok: false, fieldErrors: { name: '這個規格名稱已經存在' } }

    let sku = data.sku
    if (sku) {
      const taken = await db.productVariant.findUnique({ where: { sku }, select: { id: true } })
      if (taken) return { ok: false, fieldErrors: { sku: '這個 SKU 已經被使用' } }
    } else {
      sku = await uniqueSku()
    }

    const count = await db.productVariant.count({ where: { productId: data.productId } })

    const variant = await db.productVariant.create({
      data: {
        productId: data.productId,
        sku,
        name: data.name,
        options: { 規格: data.name },
        price: data.price,
        stock: data.stock,
        sortOrder: count,
      },
    })

    await syncBasePrice(data.productId)
    await audit({
      userId: admin.id,
      action: 'variant.create',
      entity: 'ProductVariant',
      entityId: variant.id,
      after: { name: variant.name, sku, price: data.price, stock: data.stock },
    })

    await revalidateProduct(data.productId)
    return { ok: true, message: `規格「${variant.name}」已新增` }
  } catch (error) {
    console.error('[admin] 新增規格失敗', error)
    return { ok: false, error: (error as Error).message }
  }
}

/**
 * 刪除規格。賣過的規格改為停用而不是刪除（理由同商品）。
 * 商品至少要留一個規格。
 */
export async function deleteVariant(
  variantId: string,
): Promise<{ ok: boolean; message?: string; error?: string }> {
  const admin = await requireAdmin()

  try {
    const variant = await db.productVariant.findUnique({
      where: { id: variantId },
      select: { name: true, productId: true, reservedStock: true },
    })
    if (!variant) return { ok: false, error: '找不到這個規格' }

    const total = await db.productVariant.count({ where: { productId: variant.productId } })
    if (total <= 1) {
      return { ok: false, error: '商品至少要保留一個規格，請改用「停用」或直接封存商品' }
    }

    if (variant.reservedStock > 0) {
      return { ok: false, error: '仍有未付款訂單佔用這個規格，請等訂單結束後再刪除' }
    }

    const orderedCount = await db.orderItem.count({ where: { variantId } })

    if (orderedCount > 0) {
      await db.productVariant.update({ where: { id: variantId }, data: { isActive: false } })
      await syncBasePrice(variant.productId)
      await audit({
        userId: admin.id,
        action: 'variant.deactivate',
        entity: 'ProductVariant',
        entityId: variantId,
        before: { name: variant.name },
      })
      await revalidateProduct(variant.productId)
      return { ok: true, message: `規格「${variant.name}」已有銷售紀錄，已改為停用` }
    }

    await db.productVariant.delete({ where: { id: variantId } })
    await syncBasePrice(variant.productId)
    await audit({
      userId: admin.id,
      action: 'variant.delete',
      entity: 'ProductVariant',
      entityId: variantId,
      before: { name: variant.name },
    })

    await revalidateProduct(variant.productId)
    return { ok: true, message: `規格「${variant.name}」已刪除` }
  } catch (error) {
    console.error('[admin] 刪除規格失敗', error)
    return { ok: false, error: (error as Error).message }
  }
}

// ---------------------------------------------------------------------------
// 商品圖片
// ---------------------------------------------------------------------------

export type UploadState = {
  ok: boolean
  message?: string
  error?: string
  /** 個別失敗的檔案，讓營運知道是哪幾張要重傳 */
  failures?: { filename: string; reason: string }[]
}

export async function uploadProductImages(
  _prev: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const admin = await requireAdmin()

  const productId = String(formData.get('productId') ?? '')
  if (!productId) return { ok: false, error: '缺少商品識別碼' }

  const files = formData.getAll('images').filter((f): f is File => f instanceof File)
  if (files.length === 0 || files.every((f) => f.size === 0)) {
    return { ok: false, error: '請選擇要上傳的圖片' }
  }
  if (files.length > MAX_FILES_PER_UPLOAD) {
    return { ok: false, error: `一次最多上傳 ${MAX_FILES_PER_UPLOAD} 張` }
  }

  try {
    const product = await db.product.findUnique({
      where: { id: productId },
      select: { name: true, images: { select: { sortOrder: true } } },
    })
    if (!product) return { ok: false, error: '找不到這個商品' }

    const { saved, failed } = await saveProductImages(productId, files)

    if (saved.length > 0) {
      // 接在現有圖片後面，不動既有排序
      const startOrder =
        product.images.reduce((max, img) => Math.max(max, img.sortOrder), -1) + 1

      await db.productImage.createMany({
        data: saved.map((image, i) => ({
          productId,
          url: image.url,
          alt: product.name,
          width: image.width,
          height: image.height,
          sortOrder: startOrder + i,
        })),
      })

      await audit({
        userId: admin.id,
        action: 'product.images.upload',
        entity: 'Product',
        entityId: productId,
        after: { count: saved.length, urls: saved.map((s) => s.url) },
      })

      await revalidateProduct(productId)
    }

    if (saved.length === 0) {
      return { ok: false, error: '沒有任何圖片上傳成功', failures: failed }
    }

    return {
      ok: true,
      message:
        failed.length > 0
          ? `已上傳 ${saved.length} 張，${failed.length} 張失敗`
          : `已上傳 ${saved.length} 張圖片`,
      failures: failed.length > 0 ? failed : undefined,
    }
  } catch (error) {
    console.error('[admin] 上傳圖片失敗', error)
    return { ok: false, error: (error as Error).message }
  }
}

export async function deleteProductImage(
  imageId: string,
): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin()

  try {
    const image = await db.productImage.findUnique({
      where: { id: imageId },
      select: { url: true, productId: true },
    })
    if (!image) return { ok: false, error: '找不到這張圖片' }

    await db.productImage.delete({ where: { id: imageId } })
    // 資料庫先刪再刪檔案：反過來的話檔案刪了但資料庫失敗，會留下壞掉的圖片連結
    await deleteUploadedFile(image.url)

    await audit({
      userId: admin.id,
      action: 'product.images.delete',
      entity: 'Product',
      entityId: image.productId,
      before: { url: image.url },
    })

    await revalidateProduct(image.productId)
    return { ok: true }
  } catch (error) {
    console.error('[admin] 刪除圖片失敗', error)
    return { ok: false, error: (error as Error).message }
  }
}

/**
 * 調整圖片順序。第一張就是列表與分享縮圖用的主圖，所以排序是有商業意義的。
 * 傳入完整的 id 順序陣列，一次寫入避免中間狀態。
 */
export async function reorderProductImages(
  productId: string,
  orderedIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin()

  try {
    const images = await db.productImage.findMany({
      where: { productId },
      select: { id: true },
    })
    const owned = new Set(images.map((i) => i.id))

    // 只接受「剛好是這個商品的全部圖片」，避免漏掉或夾帶別人的圖
    if (orderedIds.length !== owned.size || !orderedIds.every((id) => owned.has(id))) {
      return { ok: false, error: '圖片清單不一致，請重新載入頁面' }
    }

    await db.$transaction(
      orderedIds.map((id, index) =>
        db.productImage.update({ where: { id }, data: { sortOrder: index } }),
      ),
    )

    await audit({
      userId: admin.id,
      action: 'product.images.reorder',
      entity: 'Product',
      entityId: productId,
      after: { order: orderedIds },
    })

    await revalidateProduct(productId)
    return { ok: true }
  } catch (error) {
    console.error('[admin] 調整圖片順序失敗', error)
    return { ok: false, error: (error as Error).message }
  }
}

// ---------------------------------------------------------------------------
// 商品分類歸屬
// ---------------------------------------------------------------------------

export async function setProductCategories(
  productId: string,
  categoryIds: string[],
): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin()

  try {
    const before = await db.productCategory.findMany({
      where: { productId },
      select: { categoryId: true },
    })

    await db.$transaction(async (tx) => {
      await tx.productCategory.deleteMany({ where: { productId } })
      if (categoryIds.length > 0) {
        await tx.productCategory.createMany({
          data: categoryIds.map((categoryId) => ({ productId, categoryId })),
          skipDuplicates: true,
        })
      }
    })

    await audit({
      userId: admin.id,
      action: 'product.categories.set',
      entity: 'Product',
      entityId: productId,
      before: { categoryIds: before.map((b) => b.categoryId) },
      after: { categoryIds },
    })

    await revalidateProduct(productId)
    revalidatePath('/admin/categories')
    return { ok: true }
  } catch (error) {
    console.error('[admin] 設定商品分類失敗', error)
    return { ok: false, error: (error as Error).message }
  }
}
