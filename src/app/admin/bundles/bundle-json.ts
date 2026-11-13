/**
 * 組合的 JSON 設定：表單 ↔ JSON 互轉。
 *
 * 給「一次貼上整份設定」用 —— 例如先在試算表或聊天裡把組合寫好、複製另一個組合改一改。
 * JSON 只負責把表單填好，存檔仍然走表單送出、由伺服器（actions.ts 的 checkBundle）做最終驗證，
 * 所以這裡的檢查是給人看的友善訊息，不是安全邊界。
 *
 * 不碰 DB 也不碰 React 的純函式，單元測試在 bundle-json.test.ts。
 *
 * 商品可以用 slug、ID 或完整商品名稱指定；規格可以用 SKU、ID 或規格名稱指定，
 * 留空（null、""、"*"、"任一規格"）代表任一規格。手打 ID 太痛苦，slug 與 SKU 是人看得懂又不會撞的鍵。
 */

export interface BundleJsonProduct {
  id: string
  slug: string
  name: string
  variants: { id: string; sku: string; name: string }[]
}

export interface BundleJsonValues {
  name: string
  nameEn: string
  slug: string
  description: string
  descriptionEn: string
  price: number | ''
  sortOrder: number
  isActive: boolean
  items: { productId: string; variantId: string | null; qty: number }[]
}

export type BundleJsonResult =
  { ok: true; values: BundleJsonValues; warnings: string[] } | { ok: false; errors: string[] }

const TOP_LEVEL_KEYS = [
  'name',
  'nameEn',
  'slug',
  'description',
  'descriptionEn',
  'price',
  'sortOrder',
  'isActive',
  'items',
] as const
const ITEM_KEYS = ['product', 'variant', 'qty', 'note'] as const
const ANY_VARIANT = new Set(['', '*', '任一規格', 'any'])
const MAX_ITEMS = 20

/** 範例，同時也是 JSON 面板裡的格式說明 */
export const BUNDLE_JSON_EXAMPLE = `{
  "name": "上衣褲子兩件組",
  "nameEn": "Top & Pants Set",
  "description": "上衣搭褲子一起買更划算",
  "price": 1800,
  "isActive": false,
  "items": [
    { "product": "商品 slug、ID 或完整名稱", "variant": null, "qty": 1 },
    { "product": "另一件商品的 slug", "variant": "SKU 或規格名稱，例如 白色 / M", "qty": 1 }
  ]
}`

/** 目前表單的值 → 好讀、可以直接再貼回來的 JSON（商品用 slug、規格用 SKU，附上 note 方便人看） */
export function bundleToJson(values: BundleJsonValues, products: BundleJsonProduct[]): string {
  const byId = new Map(products.map((p) => [p.id, p]))
  const doc = {
    name: values.name,
    nameEn: values.nameEn,
    slug: values.slug,
    description: values.description,
    descriptionEn: values.descriptionEn,
    price: values.price === '' ? null : values.price,
    sortOrder: values.sortOrder,
    isActive: values.isActive,
    items: values.items
      .filter((item) => item.productId)
      .map((item) => {
        const product = byId.get(item.productId)
        const variant = product?.variants.find((v) => v.id === item.variantId)
        return {
          product: product?.slug ?? item.productId,
          variant: item.variantId ? (variant?.sku ?? item.variantId) : null,
          qty: item.qty,
          // 只是給人看的，匯入時忽略
          note: product ? `${product.name}（${variant ? variant.name : '任一規格'}）` : undefined,
        }
      }),
  }
  return JSON.stringify(doc, null, 2)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(
  doc: Record<string, unknown>,
  key: string,
  max: number,
  errors: string[],
): string {
  const value = doc[key]
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') {
    errors.push(`「${key}」要是文字`)
    return ''
  }
  const trimmed = value.trim()
  if (trimmed.length > max) errors.push(`「${key}」最多 ${max} 字`)
  return trimmed
}

/** 位置錯誤訊息：JSON.parse 的錯誤只給字元位置，換成「第幾行」人才找得到 */
function describeSyntaxError(text: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const match = /position (\d+)/.exec(message)
  if (match) {
    const position = Number(match[1])
    const line = text.slice(0, position).split('\n').length
    return `JSON 格式錯誤（第 ${line} 行附近）：${message}`
  }
  return `JSON 格式錯誤：${message}`
}

export function parseBundleJson(text: string, products: BundleJsonProduct[]): BundleJsonResult {
  if (!text.trim()) return { ok: false, errors: ['請先貼上 JSON'] }

  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch (error) {
    return { ok: false, errors: [describeSyntaxError(text, error)] }
  }
  if (!isPlainObject(doc)) {
    return { ok: false, errors: ['最外層要是一個物件 { … }（一次設定一個組合）'] }
  }

  const errors: string[] = []
  const warnings: string[] = []

  for (const key of Object.keys(doc)) {
    if (!(TOP_LEVEL_KEYS as readonly string[]).includes(key)) {
      warnings.push(`不認得的欄位「${key}」，已忽略`)
    }
  }

  const name = optionalString(doc, 'name', 80, errors)
  if (!name) errors.push('「name」組合名稱必填')

  let price: number | '' = ''
  if (doc.price === undefined || doc.price === null) {
    errors.push('「price」組合價必填')
  } else if (typeof doc.price !== 'number' || !Number.isInteger(doc.price) || doc.price < 1) {
    errors.push('「price」組合價要是大於 0 的整數（單位：元）')
  } else {
    price = doc.price
  }

  let sortOrder = 0
  if (doc.sortOrder !== undefined && doc.sortOrder !== null) {
    if (
      typeof doc.sortOrder !== 'number' ||
      !Number.isInteger(doc.sortOrder) ||
      doc.sortOrder < 0
    ) {
      errors.push('「sortOrder」排序要是 0 以上的整數')
    } else {
      sortOrder = doc.sortOrder
    }
  }

  let isActive = false
  if (doc.isActive !== undefined && doc.isActive !== null) {
    if (typeof doc.isActive !== 'boolean') errors.push('「isActive」要是 true 或 false')
    else isActive = doc.isActive
  }

  const items: BundleJsonValues['items'] = []
  if (!Array.isArray(doc.items) || doc.items.length === 0) {
    errors.push('「items」組合內容至少要有一件商品')
  } else if (doc.items.length > MAX_ITEMS) {
    errors.push(`「items」最多 ${MAX_ITEMS} 項`)
  } else {
    doc.items.forEach((raw, index) => {
      const label = `第 ${index + 1} 項`
      if (!isPlainObject(raw)) {
        errors.push(`${label}要是物件，例如 { "product": "…", "qty": 1 }`)
        return
      }
      for (const key of Object.keys(raw)) {
        if (!(ITEM_KEYS as readonly string[]).includes(key)) {
          warnings.push(`${label}有不認得的欄位「${key}」，已忽略`)
        }
      }

      if (typeof raw.product !== 'string' || !raw.product.trim()) {
        errors.push(`${label}的「product」必填（商品 slug、ID 或完整名稱）`)
        return
      }
      const key = raw.product.trim()
      const byKey = products.filter((p) => p.id === key || p.slug === key)
      const matches = byKey.length > 0 ? byKey : products.filter((p) => p.name === key)
      if (matches.length === 0) {
        errors.push(
          `${label}找不到商品「${key}」（可用 slug、ID 或完整商品名稱；已封存的商品不能選）`,
        )
        return
      }
      if (matches.length > 1) {
        errors.push(`${label}的商品名稱「${key}」對到 ${matches.length} 件商品，請改用 slug`)
        return
      }
      const product = matches[0]!

      let variantId: string | null = null
      if (raw.variant !== undefined && raw.variant !== null) {
        if (typeof raw.variant !== 'string') {
          errors.push(`${label}的「variant」要是文字（SKU 或規格名稱），任一規格請填 null`)
          return
        }
        const variantKey = raw.variant.trim()
        if (!ANY_VARIANT.has(variantKey)) {
          const exact = product.variants.filter((v) => v.id === variantKey || v.sku === variantKey)
          const variants =
            exact.length > 0 ? exact : product.variants.filter((v) => v.name === variantKey)
          if (variants.length === 0) {
            errors.push(
              `${label}「${product.name}」沒有規格「${variantKey}」，可選：${product.variants.map((v) => v.name).join('、')}`,
            )
            return
          }
          if (variants.length > 1) {
            errors.push(`${label}的規格名稱「${variantKey}」對到多個規格，請改用 SKU`)
            return
          }
          variantId = variants[0]!.id
        }
      }

      let qty = 1
      if (raw.qty !== undefined && raw.qty !== null) {
        if (
          typeof raw.qty !== 'number' ||
          !Number.isInteger(raw.qty) ||
          raw.qty < 1 ||
          raw.qty > 20
        ) {
          errors.push(`${label}的「qty」數量要是 1 到 20 的整數`)
          return
        }
        qty = raw.qty
      }

      items.push({ productId: product.id, variantId, qty })
    })
  }

  const values: BundleJsonValues = {
    name,
    nameEn: optionalString(doc, 'nameEn', 120, errors),
    slug: optionalString(doc, 'slug', 80, errors),
    description: optionalString(doc, 'description', 2000, errors),
    descriptionEn: optionalString(doc, 'descriptionEn', 2000, errors),
    price,
    sortOrder,
    isActive,
    items,
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, values, warnings }
}
