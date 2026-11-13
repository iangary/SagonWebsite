'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { slugify, formatTWD } from '@/lib/utils'
import { bundleOriginalRange } from '@/lib/bundles/match'

export type BundleFormState = {
  ok: boolean
  message?: string
  error?: string
  fieldErrors?: Record<string, string>
  /** 新增成功後要導去的編輯頁 */
  redirectTo?: string
}

export type BundleActionResult = { ok: true; message?: string } | { ok: false; error: string }

const MAX_ITEMS = 20

const itemSchema = z.object({
  productId: z.string().min(1),
  // 空字串與 null 都代表「任一規格」
  variantId: z
    .string()
    .nullish()
    .transform((v) => v || null),
  qty: z.coerce.number().int().min(1, '數量至少 1 件').max(20, '單項最多 20 件'),
})

const schema = z.object({
  id: z.string().optional().default(''),
  name: z.string().trim().min(1, '請填組合名稱').max(80, '名稱最多 80 字'),
  nameEn: z.string().trim().max(120).optional().default(''),
  slug: z.string().trim().max(80).optional().default(''),
  description: z.string().trim().max(2000).optional().default(''),
  descriptionEn: z.string().trim().max(2000).optional().default(''),
  price: z.coerce.number().int('組合價必須是整數').min(1, '組合價至少 1 元').max(1_000_000),
  sortOrder: z.coerce.number().int().min(0).max(1_000_000).optional().default(0),
  // checkbox：勾了才會出現在 FormData
  isActive: z
    .string()
    .optional()
    .transform((v) => v === 'on' || v === 'true'),
  items: z.string().transform((raw, ctx) => {
    try {
      return JSON.parse(raw) as unknown
    } catch {
      ctx.addIssue({ code: 'custom', message: '組合內容格式不正確' })
      return z.NEVER
    }
  }),
})

type BundleItemInput = z.infer<typeof itemSchema>

/**
 * 檢查組合內容並算出原價範圍。後台的新增、修改、上架三條路共用。
 *
 * - 商品要存在；指定的規格要屬於那件商品。
 * - 同一件商品＋同一個規格（或同為「任一規格」）的重複項目合併數量。
 * - 組合價必須低於「最便宜的組法」的原價合計 —— 否則有些組法對顧客沒有省到，
 *   購物車也不會套用，前台的「現省」會變成 0 或負數。
 * - 要上架時，每件商品都得在架上、指定的規格都得開著。
 */
async function checkBundle(
  rawItems: BundleItemInput[],
  price: number,
  requireSellable: boolean,
): Promise<
  | {
      ok: true
      items: BundleItemInput[]
      originalMin: number
      originalMax: number
    }
  | { ok: false; error: string }
> {
  if (rawItems.length === 0) return { ok: false, error: '組合至少要有一件商品' }
  if (rawItems.length > MAX_ITEMS) return { ok: false, error: `組合最多 ${MAX_ITEMS} 項` }

  const merged = new Map<string, BundleItemInput>()
  for (const item of rawItems) {
    const key = `${item.productId}:${item.variantId ?? '*'}`
    const existing = merged.get(key)
    if (existing) existing.qty += item.qty
    else merged.set(key, { ...item })
  }
  const items = [...merged.values()]

  const products = await db.product.findMany({
    where: { id: { in: [...new Set(items.map((i) => i.productId))] } },
    select: {
      id: true,
      name: true,
      status: true,
      variants: {
        select: { id: true, name: true, price: true, isActive: true },
      },
    },
  })
  const byId = new Map(products.map((p) => [p.id, p]))

  const priced: { qty: number; prices: number[] }[] = []
  for (const item of items) {
    const product = byId.get(item.productId)
    if (!product) return { ok: false, error: '組合裡有找不到的商品，請重新選擇' }
    if (requireSellable && product.status !== 'ACTIVE') {
      return { ok: false, error: `「${product.name}」沒有上架，組合不能上架` }
    }

    if (item.variantId) {
      const variant = product.variants.find((v) => v.id === item.variantId)
      if (!variant)
        return {
          ok: false,
          error: `「${product.name}」沒有這個規格，請重新選擇`,
        }
      if (requireSellable && !variant.isActive) {
        return {
          ok: false,
          error: `「${product.name}」的規格「${variant.name}」已停用，組合不能上架`,
        }
      }
      priced.push({ qty: item.qty, prices: [variant.price] })
    } else {
      const active = product.variants.filter((v) => v.isActive)
      if (active.length === 0) {
        return { ok: false, error: `「${product.name}」沒有可販售的規格` }
      }
      priced.push({ qty: item.qty, prices: active.map((v) => v.price) })
    }
  }

  const range = bundleOriginalRange(priced)
  if (price >= range.min) {
    return {
      ok: false,
      error: `組合價必須低於原價合計（${range.min === range.max ? '' : '最便宜的組法是 '}${formatTWD(range.min)}），否則顧客沒有省到`,
    }
  }

  return { ok: true, items, originalMin: range.min, originalMax: range.max }
}

async function uniqueBundleSlug(input: string, excludeId?: string): Promise<string> {
  const base = slugify(input) || `bundle-${Date.now().toString(36)}`
  for (let suffix = 0; suffix < 50; suffix++) {
    const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`
    const taken = await db.bundle.findUnique({
      where: { slug: candidate },
      select: { id: true },
    })
    if (!taken || taken.id === excludeId) return candidate
  }
  return `${base}-${Date.now().toString(36)}`
}

function revalidateBundles(slug?: string) {
  revalidatePath('/admin/bundles')
  revalidatePath('/bundles')
  if (slug) revalidatePath(`/bundles/${slug}`)
}

/** 新增或修改組合（formData 帶 id 就是修改）。 */
export async function saveBundle(
  _prev: BundleFormState,
  formData: FormData,
): Promise<BundleFormState> {
  const admin = await requireAdmin()

  const parsed = schema.safeParse(Object.fromEntries(formData.entries()))
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0] ?? '_')] ??= issue.message
    }
    return { ok: false, fieldErrors }
  }
  const data = parsed.data

  const itemsParsed = z.array(itemSchema).safeParse(data.items)
  if (!itemsParsed.success) {
    return {
      ok: false,
      fieldErrors: {
        items: itemsParsed.error.issues[0]?.message ?? '組合內容不正確',
      },
    }
  }

  const checked = await checkBundle(itemsParsed.data, data.price, data.isActive)
  if (!checked.ok) return { ok: false, fieldErrors: { items: checked.error } }

  const existing = data.id
    ? await db.bundle.findUnique({
        where: { id: data.id },
        select: { id: true, slug: true, name: true, price: true },
      })
    : null
  if (data.id && !existing) return { ok: false, error: '找不到這個組合' }

  // slug 是對外連結：沒填就用名稱產生；修改時沒填就沿用原本的
  const slug = data.slug
    ? await uniqueBundleSlug(data.slug, existing?.id)
    : (existing?.slug ?? (await uniqueBundleSlug(data.name)))

  const fields = {
    slug,
    name: data.name,
    nameEn: data.nameEn || null,
    description: data.description || null,
    descriptionEn: data.descriptionEn || null,
    price: data.price,
    isActive: data.isActive,
    sortOrder: data.sortOrder,
  }
  const itemRows = checked.items.map((item, index) => ({
    productId: item.productId,
    variantId: item.variantId,
    qty: item.qty,
    sortOrder: index,
  }))

  try {
    const bundle = await db.$transaction(async (tx) => {
      if (existing) {
        await tx.bundleItem.deleteMany({ where: { bundleId: existing.id } })
        return tx.bundle.update({
          where: { id: existing.id },
          data: { ...fields, items: { create: itemRows } },
        })
      }
      return tx.bundle.create({
        data: { ...fields, items: { create: itemRows } },
      })
    })

    await audit({
      userId: admin.id,
      action: existing ? 'bundle.update' : 'bundle.create',
      entity: 'Bundle',
      entityId: bundle.id,
      before: existing ? { name: existing.name, price: existing.price } : undefined,
      after: { ...fields, items: itemRows },
    })

    revalidateBundles(bundle.slug)
    if (existing && existing.slug !== bundle.slug) revalidatePath(`/bundles/${existing.slug}`)

    return existing
      ? { ok: true, message: `組合「${bundle.name}」已儲存` }
      : {
          ok: true,
          message: `組合「${bundle.name}」已建立`,
          redirectTo: `/admin/bundles/${bundle.id}`,
        }
  } catch (error) {
    console.error('[admin] 儲存組合失敗', error)
    return { ok: false, error: '儲存失敗，請稍後再試' }
  }
}

/** 上架／下架。上架前重驗一次內容（商品可能在建立組合之後被下架或改價）。 */
export async function toggleBundle(
  bundleId: string,
  isActive: boolean,
): Promise<BundleActionResult> {
  const admin = await requireAdmin()

  const bundle = await db.bundle.findUnique({
    where: { id: bundleId },
    select: {
      slug: true,
      price: true,
      items: { select: { productId: true, variantId: true, qty: true } },
    },
  })
  if (!bundle) return { ok: false, error: '找不到這個組合' }

  if (isActive) {
    const checked = await checkBundle(bundle.items, bundle.price, true)
    if (!checked.ok) return { ok: false, error: checked.error }
  }

  await db.bundle.update({ where: { id: bundleId }, data: { isActive } })
  await audit({
    userId: admin.id,
    action: isActive ? 'bundle.activate' : 'bundle.deactivate',
    entity: 'Bundle',
    entityId: bundleId,
  })
  revalidateBundles(bundle.slug)
  return { ok: true, message: isActive ? '已上架' : '已下架' }
}

/**
 * 上移／下移一格。順序同時決定前台列表的排列，以及兩個組合搶同一件商品、省的金額又相同時誰優先。
 * 重寫整串的 sortOrder（0, 10, 20…），不怕原本有重複的值。
 */
export async function moveBundle(
  bundleId: string,
  direction: 'up' | 'down',
): Promise<BundleActionResult> {
  const admin = await requireAdmin()

  const all = await db.bundle.findMany({
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  })
  const index = all.findIndex((b) => b.id === bundleId)
  if (index === -1) return { ok: false, error: '找不到這個組合' }

  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= all.length) return { ok: true }

  const ids = all.map((b) => b.id)
  ;[ids[index], ids[target]] = [ids[target]!, ids[index]!]

  await db.$transaction(
    ids.map((id, i) => db.bundle.update({ where: { id }, data: { sortOrder: i * 10 } })),
  )
  await audit({
    userId: admin.id,
    action: 'bundle.reorder',
    entity: 'Bundle',
    entityId: bundleId,
    after: { direction },
  })
  revalidateBundles()
  return { ok: true }
}

/** 刪除組合。已成立訂單上的組合快照（OrderBundle）保留，只是不再連到這個組合。 */
export async function deleteBundle(bundleId: string): Promise<BundleActionResult> {
  const admin = await requireAdmin()

  const bundle = await db.bundle.findUnique({
    where: { id: bundleId },
    select: { name: true, slug: true },
  })
  if (!bundle) return { ok: false, error: '找不到這個組合' }

  await db.bundle.delete({ where: { id: bundleId } })
  await audit({
    userId: admin.id,
    action: 'bundle.delete',
    entity: 'Bundle',
    entityId: bundleId,
    before: bundle,
  })
  revalidateBundles(bundle.slug)
  return { ok: true, message: `組合「${bundle.name}」已刪除` }
}
