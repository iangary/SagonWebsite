'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { audit } from '@/lib/audit'

export type ProductFormState = {
  ok: boolean
  message?: string
  error?: string
  fieldErrors?: Record<string, string>
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

    // basePrice 是列表頁顯示用的快取欄位，變體改價後要同步成最低價
    const cheapest = await db.productVariant.findFirst({
      where: { productId: before.productId, isActive: true },
      orderBy: { price: 'asc' },
      select: { price: true },
    })
    if (cheapest) {
      await db.product.update({
        where: { id: before.productId },
        data: { basePrice: cheapest.price },
      })
    }

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
