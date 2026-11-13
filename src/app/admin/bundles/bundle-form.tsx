'use client'

import * as React from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { formatTWD } from '@/lib/utils'
import { saveBundle, type BundleFormState } from './actions'
import { BundleJsonPanel } from './bundle-json-panel'
import type { BundleJsonValues } from './bundle-json'
import type { BundleProductOption } from './product-options'

const INITIAL: BundleFormState = { ok: false }

export interface BundleFormValues {
  id?: string
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

type Row = { key: string; productId: string; variantId: string; qty: number }

const STATUS_LABEL = { DRAFT: '草稿', ACTIVE: '', ARCHIVED: '已封存' } as const

// 列的 key 也拿來組 label 的 htmlFor。不能用模組層級的計數器 —— 伺服器端每次請求都會累加，
// 伺服器畫出 row-5、瀏覽器畫出 row-1，就是 hydration mismatch。初始列用索引、之後新增的列才遞增。
const initialKey = (index: number) => `row-${index + 1}`

/**
 * 組合表單。外層只管「用 JSON 整份替換」：套用 JSON 時換一個 key 讓表單重新掛載，
 * 名稱、說明這些非受控欄位才會換成新的預設值。
 *
 * JSON 面板放在外層、不跟著重新掛載 —— 套用之後貼上的 JSON 與展開狀態都還在，
 * 對照著表單檢查、改一個字再套用一次都很方便。
 */
export function BundleForm({
  initial,
  products,
}: {
  initial: BundleFormValues
  products: BundleProductOption[]
}) {
  const { toast } = useToast()
  const [current, setCurrent] = React.useState({
    values: initial,
    version: 0,
    autoSubmit: false,
  })
  // 內層表單把「讀目前的值」交上來，給 JSON 面板匯出用
  const snapshotRef = React.useRef<(() => BundleJsonValues) | null>(null)

  return (
    <div className="space-y-8">
      <BundleJsonPanel
        products={products}
        getCurrent={() => snapshotRef.current?.() ?? current.values}
        submitLabel={initial.id ? '儲存' : '建立'}
        onApply={(values, { submit }) => {
          if (!submit) {
            toast(`已套用 JSON，確認表單內容後再按「${initial.id ? '儲存' : '建立組合'}」`)
          }
          setCurrent((c) => ({
            // 編輯中的組合：JSON 只換內容，不換是哪一個組合
            values: { ...values, id: initial.id },
            version: c.version + 1,
            autoSubmit: submit,
          }))
        }}
      />
      <BundleFormFields
        key={current.version}
        initial={current.values}
        autoSubmit={current.autoSubmit}
        products={products}
        snapshotRef={snapshotRef}
      />
    </div>
  )
}

function BundleFormFields({
  initial,
  products,
  autoSubmit,
  snapshotRef,
}: {
  initial: BundleFormValues
  products: BundleProductOption[]
  /** JSON 面板按「套用並建立／儲存」時，重新掛載後直接送出 */
  autoSubmit: boolean
  snapshotRef: React.RefObject<(() => BundleJsonValues) | null>
}) {
  const router = useRouter()
  const formRef = React.useRef<HTMLFormElement>(null)
  const { toast } = useToast()
  const [state, formAction, pending] = useActionState(saveBundle, INITIAL)
  const [price, setPrice] = React.useState<number | ''>(initial.price)
  const [rows, setRows] = React.useState<Row[]>(() =>
    initial.items.length > 0
      ? initial.items.map((item, index) => ({
          key: initialKey(index),
          productId: item.productId,
          variantId: item.variantId ?? '',
          qty: item.qty,
        }))
      : [{ key: initialKey(0), productId: '', variantId: '', qty: 1 }],
  )
  const [filter, setFilter] = React.useState('')
  // 新增列的流水號，從初始列數之後接著編
  const rowSeq = React.useRef(Math.max(1, initial.items.length))

  // 「套用並建立」：等新的值都畫上去（隱藏欄位 items 也更新了）才送出
  // 用 ref 擋重複送出：開發模式的 StrictMode 會把 mount 時的 effect 跑兩次，
  // 沒擋的話同一份 JSON 會存兩次（稽核紀錄也會多一筆）。
  const autoSubmitted = React.useRef(false)
  React.useEffect(() => {
    if (!autoSubmit || autoSubmitted.current) return
    autoSubmitted.current = true
    formRef.current?.requestSubmit()
  }, [autoSubmit])

  /** 目前表單上的值（含還沒存的修改），給 JSON 面板匯出 */
  function snapshot(): BundleJsonValues {
    const data = new FormData(formRef.current ?? undefined)
    const text = (key: string) => String(data.get(key) ?? '').trim()
    return {
      name: text('name'),
      nameEn: text('nameEn'),
      slug: text('slug'),
      description: text('description'),
      descriptionEn: text('descriptionEn'),
      price,
      sortOrder: Number(text('sortOrder')) || 0,
      isActive: data.get('isActive') === 'on',
      items: rows
        .filter((row) => row.productId)
        .map((row) => ({
          productId: row.productId,
          variantId: row.variantId || null,
          qty: row.qty,
        })),
    }
  }
  React.useEffect(() => {
    snapshotRef.current = snapshot
  })

  React.useEffect(() => {
    if (state.ok && state.message) {
      toast(state.message)
      if (state.redirectTo) router.push(state.redirectTo)
      else router.refresh()
    }
    if (state.error) toast(state.error, 'error')
  }, [state, toast, router])

  const byId = React.useMemo(() => new Map(products.map((p) => [p.id, p])), [products])
  const visibleProducts = React.useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? products.filter((p) => p.name.toLowerCase().includes(q)) : products
  }, [filter, products])

  function update(key: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  // 即時試算：「任一規格」取開著的規格中最便宜／最貴的
  let min = 0
  let max = 0
  let complete = true
  for (const row of rows) {
    const product = byId.get(row.productId)
    if (!product) {
      complete = false
      continue
    }
    const prices = row.variantId
      ? product.variants.filter((v) => v.id === row.variantId).map((v) => v.price)
      : product.variants.filter((v) => v.isActive).map((v) => v.price)
    if (prices.length === 0) continue
    min += Math.min(...prices) * row.qty
    max += Math.max(...prices) * row.qty
  }
  const saving = typeof price === 'number' ? min - price : 0

  const itemsJson = JSON.stringify(
    rows
      .filter((row) => row.productId)
      .map((row) => ({
        productId: row.productId,
        variantId: row.variantId || null,
        qty: row.qty,
      })),
  )

  const errors = state.fieldErrors ?? {}

  return (
    <form ref={formRef} action={formAction} className="space-y-8">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="items" value={itemsJson} />

      <section className="border border-cream-200 bg-white p-5">
        <h2 className="mb-5 text-sm tracking-[0.1em]">基本資料</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="組合名稱" htmlFor="name" required error={errors.name}>
            <Input id="name" name="name" defaultValue={initial.name} maxLength={80} required />
          </Field>
          <Field
            label="英文名稱"
            htmlFor="nameEn"
            hint="留白時英文、日文、韓文、法文頁面顯示中文名稱"
          >
            <Input id="nameEn" name="nameEn" defaultValue={initial.nameEn} maxLength={120} />
          </Field>
          <Field
            label="網址代稱"
            htmlFor="slug"
            error={errors.slug}
            hint={initial.id ? '改了舊連結就會失效' : '留白時用組合名稱產生'}
          >
            <Input
              id="slug"
              name="slug"
              defaultValue={initial.slug}
              maxLength={80}
              className="font-mono"
            />
          </Field>
          <Field label="排序" htmlFor="sortOrder" hint="數字小的在前；列表頁也可以用上下箭頭調整">
            <Input
              id="sortOrder"
              name="sortOrder"
              type="number"
              min={0}
              defaultValue={initial.sortOrder}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="說明" htmlFor="description">
              <Textarea
                id="description"
                name="description"
                rows={3}
                maxLength={2000}
                defaultValue={initial.description}
              />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="英文說明" htmlFor="descriptionEn">
              <Textarea
                id="descriptionEn"
                name="descriptionEn"
                rows={3}
                maxLength={2000}
                defaultValue={initial.descriptionEn}
              />
            </Field>
          </div>
        </div>
      </section>

      <section className="border border-cream-200 bg-white p-5">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm tracking-[0.1em]">組合內容</h2>
            <p className="mt-1 text-xs text-taupe-500">
              「任一規格」讓顧客自己挑顏色尺寸；指定規格則只有那個規格算數。
            </p>
          </div>
          <Input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="篩選商品名稱…"
            aria-label="篩選商品名稱"
            className="max-w-xs"
          />
        </div>

        <ul className="space-y-3">
          {rows.map((row, index) => {
            const product = byId.get(row.productId)
            // 篩選時保留已選的那件，不然選單會突然變空
            const options =
              product && !visibleProducts.includes(product)
                ? [product, ...visibleProducts]
                : visibleProducts
            return (
              <li
                key={row.key}
                className="grid gap-3 border border-cream-200 p-3 sm:grid-cols-[1fr_12rem_6rem_auto] sm:items-end"
              >
                <Field label={`第 ${index + 1} 項商品`} htmlFor={`${row.key}-product`}>
                  <Select
                    id={`${row.key}-product`}
                    value={row.productId}
                    onChange={(e) =>
                      update(row.key, {
                        productId: e.target.value,
                        variantId: '',
                      })
                    }
                  >
                    <option value="">請選擇商品</option>
                    {options.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {STATUS_LABEL[p.status] && `（${STATUS_LABEL[p.status]}）`}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="規格" htmlFor={`${row.key}-variant`}>
                  <Select
                    id={`${row.key}-variant`}
                    value={row.variantId}
                    disabled={!product}
                    onChange={(e) => update(row.key, { variantId: e.target.value })}
                  >
                    <option value="">任一規格（顧客自選）</option>
                    {product?.variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} · {formatTWD(v.price)}
                        {!v.isActive && '（已停用）'}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="數量" htmlFor={`${row.key}-qty`}>
                  <Input
                    id={`${row.key}-qty`}
                    type="number"
                    min={1}
                    max={20}
                    value={row.qty}
                    onChange={(e) =>
                      update(row.key, {
                        qty: Math.max(1, Math.min(20, Number(e.target.value) || 1)),
                      })
                    }
                  />
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={rows.length <= 1}
                  aria-label={`移除第 ${index + 1} 項`}
                  onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                >
                  <Trash2 size={15} />
                </Button>
              </li>
            )
          })}
        </ul>

        {errors.items && <p className="mt-3 text-sm text-sale">{errors.items}</p>}

        <Button
          type="button"
          variant="subtle"
          size="sm"
          className="mt-4"
          disabled={rows.length >= 20}
          onClick={() =>
            setRows((current) => [
              ...current,
              { key: `row-${++rowSeq.current}`, productId: '', variantId: '', qty: 1 },
            ])
          }
        >
          <Plus size={14} />
          加一項商品
        </Button>
      </section>

      <section className="border border-cream-200 bg-white p-5">
        <h2 className="mb-5 text-sm tracking-[0.1em]">價格與上架</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="組合價" htmlFor="price" required error={errors.price}>
            <Input
              id="price"
              name="price"
              type="number"
              min={1}
              value={price}
              onChange={(e) => setPrice(e.target.value === '' ? '' : Number(e.target.value))}
              required
            />
          </Field>
          <div className="text-sm">
            <p className="text-xs tracking-wide text-taupe-600">原價合計</p>
            <p className="mt-2 tabular-nums">
              {complete && min > 0
                ? `${formatTWD(min)}${max > min ? ` – ${formatTWD(max)}` : ''}`
                : '—'}
            </p>
          </div>
          <div className="text-sm">
            <p className="text-xs tracking-wide text-taupe-600">顧客現省</p>
            <p className={`mt-2 tabular-nums ${saving > 0 ? 'text-sale' : 'text-taupe-500'}`}>
              {complete && typeof price === 'number' && min > 0
                ? saving > 0
                  ? `${formatTWD(saving)}${max > min ? ' 起' : ''}`
                  : '組合價要低於原價合計'
                : '—'}
            </p>
          </div>
        </div>

        <label className="mt-5 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={initial.isActive}
            className="size-4 accent-ink-900"
          />
          上架（前台顯示組合，購物車湊齊就自動套用組合價）
        </label>
      </section>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => router.push('/admin/bundles')}>
          回列表
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? '儲存中…' : initial.id ? '儲存' : '建立組合'}
        </Button>
      </div>
    </form>
  )
}
