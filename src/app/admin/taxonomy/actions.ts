'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { uniqueSlug } from '@/lib/catalog/slug'

/**
 * 分類與品牌的維護。兩者都是「商品的分群方式」，規則也幾乎一樣，
 * 所以放在同一個模組。
 *
 * 共通規則：
 *   - slug 由名稱自動產生，建立後不可修改（對外連結與 SEO）
 *   - 底下還有商品時不允許刪除，避免商品變成沒有分類的孤兒
 */

export type TaxonomyState = {
  ok: boolean
  message?: string
  error?: string
  fieldErrors?: Record<string, string>
}

function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) out[String(issue.path[0] ?? '_')] ??= issue.message
  return out
}

/** 分類會出現在每一頁的導覽列，所以改動後要讓整個 layout 的快取失效 */
function revalidateNav() {
  revalidatePath('/admin/taxonomy')
  revalidatePath('/', 'layout')
}

// ---------------------------------------------------------------------------
// 分類
// ---------------------------------------------------------------------------

const categorySchema = z.object({
  id: z.string().optional().default(''),
  name: z.string().trim().min(1, '請輸入分類名稱').max(60),
  nameEn: z.string().trim().max(60).optional().default(''),
  parentId: z.string().optional().default(''),
  sortOrder: z.coerce.number().int().min(0).max(9999),
})

export async function saveCategory(
  _prev: TaxonomyState,
  formData: FormData,
): Promise<TaxonomyState> {
  const admin = await requireAdmin()

  const parsed = categorySchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) }

  const { id, name, nameEn, parentId, sortOrder } = parsed.data

  try {
    if (id) {
      // 不能把分類設成自己的子分類，那會做出一個永遠展不開的迴圈
      if (parentId === id) {
        return { ok: false, fieldErrors: { parentId: '不能把自己設為上層分類' } }
      }
      // 也不能設成自己的子孫（同樣會形成迴圈）
      if (parentId && (await isDescendant(parentId, id))) {
        return { ok: false, fieldErrors: { parentId: '不能把自己的子分類設為上層分類' } }
      }

      const before = await db.category.findUniqueOrThrow({
        where: { id },
        select: { name: true, nameEn: true, parentId: true, sortOrder: true },
      })

      await db.category.update({
        where: { id },
        data: { name, nameEn: nameEn || null, parentId: parentId || null, sortOrder },
      })

      await audit({
        userId: admin.id,
        action: 'category.update',
        entity: 'Category',
        entityId: id,
        before,
        after: { name, nameEn, parentId, sortOrder },
      })

      revalidateNav()
      return { ok: true, message: `分類「${name}」已更新` }
    }

    const slug = await uniqueSlug('category', name, 'category')
    const created = await db.category.create({
      data: { slug, name, nameEn: nameEn || null, parentId: parentId || null, sortOrder },
    })

    await audit({
      userId: admin.id,
      action: 'category.create',
      entity: 'Category',
      entityId: created.id,
      after: { name, slug, parentId, sortOrder },
    })

    revalidateNav()
    return { ok: true, message: `分類「${name}」已建立` }
  } catch (error) {
    console.error('[admin] 儲存分類失敗', error)
    return { ok: false, error: (error as Error).message }
  }
}

/** 判斷 candidate 是否為 ancestorId 的子孫，用來擋掉迴圈 */
async function isDescendant(candidateId: string, ancestorId: string): Promise<boolean> {
  let current: string | null = candidateId
  // 加上層數上限，資料萬一已經有迴圈也不會卡死
  for (let depth = 0; depth < 20 && current; depth++) {
    const node: { parentId: string | null } | null = await db.category.findUnique({
      where: { id: current },
      select: { parentId: true },
    })
    if (!node) return false
    if (node.parentId === ancestorId) return true
    current = node.parentId
  }
  return false
}

export async function deleteCategory(
  categoryId: string,
): Promise<{ ok: boolean; message?: string; error?: string }> {
  const admin = await requireAdmin()

  try {
    const category = await db.category.findUnique({
      where: { id: categoryId },
      select: {
        name: true,
        _count: { select: { products: true, children: true } },
      },
    })
    if (!category) return { ok: false, error: '找不到這個分類' }

    if (category._count.products > 0) {
      return {
        ok: false,
        error: `還有 ${category._count.products} 件商品屬於這個分類，請先移除歸屬再刪除`,
      }
    }
    if (category._count.children > 0) {
      return { ok: false, error: '這個分類底下還有子分類，請先處理子分類' }
    }

    await db.category.delete({ where: { id: categoryId } })
    await audit({
      userId: admin.id,
      action: 'category.delete',
      entity: 'Category',
      entityId: categoryId,
      before: { name: category.name },
    })

    revalidateNav()
    return { ok: true, message: `分類「${category.name}」已刪除` }
  } catch (error) {
    console.error('[admin] 刪除分類失敗', error)
    return { ok: false, error: (error as Error).message }
  }
}

// ---------------------------------------------------------------------------
// 品牌
// ---------------------------------------------------------------------------

const brandSchema = z.object({
  id: z.string().optional().default(''),
  name: z.string().trim().min(1, '請輸入品牌名稱').max(60),
  description: z.string().trim().max(300).optional().default(''),
  sortOrder: z.coerce.number().int().min(0).max(9999),
})

export async function saveBrand(
  _prev: TaxonomyState,
  formData: FormData,
): Promise<TaxonomyState> {
  const admin = await requireAdmin()

  const parsed = brandSchema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) }

  const { id, name, description, sortOrder } = parsed.data

  try {
    if (id) {
      const before = await db.brand.findUniqueOrThrow({
        where: { id },
        select: { name: true, description: true, sortOrder: true },
      })

      await db.brand.update({
        where: { id },
        data: { name, description: description || null, sortOrder },
      })

      await audit({
        userId: admin.id,
        action: 'brand.update',
        entity: 'Brand',
        entityId: id,
        before,
        after: { name, description, sortOrder },
      })

      revalidatePath('/admin/taxonomy')
      revalidatePath('/', 'layout')
      return { ok: true, message: `品牌「${name}」已更新` }
    }

    const slug = await uniqueSlug('brand', name, 'brand')
    const created = await db.brand.create({
      data: { slug, name, description: description || null, sortOrder },
    })

    await audit({
      userId: admin.id,
      action: 'brand.create',
      entity: 'Brand',
      entityId: created.id,
      after: { name, slug, sortOrder },
    })

    revalidatePath('/admin/taxonomy')
    revalidatePath('/', 'layout')
    return { ok: true, message: `品牌「${name}」已建立` }
  } catch (error) {
    console.error('[admin] 儲存品牌失敗', error)
    return { ok: false, error: (error as Error).message }
  }
}

export async function deleteBrand(
  brandId: string,
): Promise<{ ok: boolean; message?: string; error?: string }> {
  const admin = await requireAdmin()

  try {
    const brand = await db.brand.findUnique({
      where: { id: brandId },
      select: { name: true, _count: { select: { products: true } } },
    })
    if (!brand) return { ok: false, error: '找不到這個品牌' }

    if (brand._count.products > 0) {
      return {
        ok: false,
        error: `還有 ${brand._count.products} 件商品屬於這個品牌，請先改掉商品的品牌再刪除`,
      }
    }

    await db.brand.delete({ where: { id: brandId } })
    await audit({
      userId: admin.id,
      action: 'brand.delete',
      entity: 'Brand',
      entityId: brandId,
      before: { name: brand.name },
    })

    revalidatePath('/admin/taxonomy')
    revalidatePath('/', 'layout')
    return { ok: true, message: `品牌「${brand.name}」已刪除` }
  } catch (error) {
    console.error('[admin] 刪除品牌失敗', error)
    return { ok: false, error: (error as Error).message }
  }
}
