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

let rowSeq = 0
const newKey = () => `row-${++rowSeq}`

export function BundleForm({
  initial,
  products,
}: {
  initial: BundleFormValues
  products: BundleProductOption[]
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [state, formAction, pending] = useActionState(saveBundle, INITIAL)
  const [price, setPrice] = React.useState<number | ''>(initial.price)
  const [rows, setRows] = React.useState<Row[]>(() =>
    initial.items.length > 0
      ? initial.items.map((item) => ({
          key: newKey(),
          productId: item.productId,
          variantId: item.variantId ?? '',
          qty: item.qty,
        }))
      : [{ key: newKey(), productId: '', variantId: '', qty: 1 }],
  )
  const [filter, setFilter] = React.useState('')

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
    <form action={formAction} className="space-y-8">
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
              { key: newKey(), productId: '', variantId: '', qty: 1 },
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
