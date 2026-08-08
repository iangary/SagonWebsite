'use client'

import * as React from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { Save, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Textarea, Select, Field } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { DataTable, Td } from '@/components/admin/ui'
import {
  updateProduct,
  updateVariant,
  addVariant,
  deleteVariant,
  setProductCategories,
  type ProductFormState,
} from '../actions'
import { formatTWD, cn } from '@/lib/utils'

type Variant = {
  id: string
  sku: string
  name: string
  price: number
  stock: number
  reservedStock: number
  isActive: boolean
}

const INITIAL: ProductFormState = { ok: false }

export function ProductEditor({
  product,
  brands,
  allCategories,
  selectedCategoryIds,
  variants,
}: {
  product: {
    id: string
    name: string
    summary: string
    status: string
    brandId: string
    seoTitle: string
    seoDescription: string
    slug: string
  }
  brands: { id: string; name: string }[]
  allCategories: { id: string; name: string }[]
  selectedCategoryIds: string[]
  variants: Variant[]
}) {
  const { toast } = useToast()
  const [state, formAction, pending] = useActionState(updateProduct, INITIAL)

  React.useEffect(() => {
    if (state.ok && state.message) toast(state.message)
    if (state.error) toast(state.error, 'error')
  }, [state, toast])

  const errors = state.fieldErrors ?? {}

  return (
    <div className="space-y-6">
      <form action={formAction} className="border border-cream-200 bg-white p-5">
        <input type="hidden" name="id" value={product.id} />

        <h2 className="mb-5 text-sm tracking-[0.1em]">基本資料</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="商品名稱" htmlFor="name" required error={errors.name}>
              <Input id="name" name="name" defaultValue={product.name} required />
            </Field>
          </div>

          <Field label="狀態" htmlFor="status" required>
            <Select id="status" name="status" defaultValue={product.status}>
              <option value="ACTIVE">上架中</option>
              <option value="DRAFT">草稿</option>
              <option value="ARCHIVED">已封存</option>
            </Select>
          </Field>

          <Field label="品牌" htmlFor="brandId">
            <Select id="brandId" name="brandId" defaultValue={product.brandId}>
              <option value="">未指定</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </Select>
          </Field>

          <div className="sm:col-span-2">
            <Field label="摘要" htmlFor="summary" hint="顯示在列表與 OG 描述">
              <Textarea id="summary" name="summary" defaultValue={product.summary} maxLength={500} />
            </Field>
          </div>

          <Field label="SEO 標題" htmlFor="seoTitle">
            <Input id="seoTitle" name="seoTitle" defaultValue={product.seoTitle} maxLength={200} />
          </Field>

          <Field label="網址 slug" htmlFor="slug" hint="建立後不可修改，避免外部連結失效">
            <Input id="slug" value={product.slug} disabled />
          </Field>

          <div className="sm:col-span-2">
            <Field label="SEO 描述" htmlFor="seoDescription">
              <Textarea
                id="seoDescription"
                name="seoDescription"
                defaultValue={product.seoDescription}
                maxLength={300}
              />
            </Field>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <Button type="submit" disabled={pending}>
            <Save size={15} />
            {pending ? '儲存中…' : '儲存'}
          </Button>
        </div>
      </form>

      <CategoryPicker
        productId={product.id}
        allCategories={allCategories}
        initialSelected={selectedCategoryIds}
      />

      <VariantSection productId={product.id} variants={variants} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// 分類歸屬
// ---------------------------------------------------------------------------

function CategoryPicker({
  productId,
  allCategories,
  initialSelected,
}: {
  productId: string
  allCategories: { id: string; name: string }[]
  initialSelected: string[]
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [selected, setSelected] = React.useState(initialSelected)
  const [pending, setPending] = React.useState(false)

  // 用集合比較，順序不同不算變更
  const dirty =
    selected.length !== initialSelected.length ||
    selected.some((id) => !initialSelected.includes(id))

  async function save() {
    setPending(true)
    const result = await setProductCategories(productId, selected)
    setPending(false)
    if (!result.ok) {
      toast(result.error ?? '儲存失敗', 'error')
      return
    }
    toast('分類已更新')
    router.refresh()
  }

  if (allCategories.length === 0) {
    return (
      <section className="border border-cream-200 bg-white p-5">
        <h2 className="text-sm tracking-[0.1em]">分類</h2>
        <p className="mt-3 text-sm text-taupe-500">
          目前還沒有任何分類。請先到「分類」頁面建立。
        </p>
      </section>
    )
  }

  return (
    <section className="border border-cream-200 bg-white p-5">
      <h2 className="text-sm tracking-[0.1em]">分類</h2>
      <p className="mt-2 text-xs text-taupe-500">分類決定這件商品出現在哪些導覽頁面，可多選。</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {allCategories.map((category) => {
          const active = selected.includes(category.id)
          return (
            <button
              key={category.id}
              type="button"
              aria-pressed={active}
              onClick={() =>
                setSelected((prev) =>
                  prev.includes(category.id)
                    ? prev.filter((c) => c !== category.id)
                    : [...prev, category.id],
                )
              }
              className={cn(
                'border px-3 py-1.5 text-xs transition-colors',
                active
                  ? 'border-ink-900 bg-ink-900 text-cream-50'
                  : 'border-cream-300 text-ink-700 hover:border-taupe-400',
              )}
            >
              {category.name}
            </button>
          )
        })}
      </div>

      {dirty && (
        <Button size="sm" className="mt-4" disabled={pending} onClick={save}>
          {pending ? '儲存中…' : '儲存分類'}
        </Button>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// 規格
// ---------------------------------------------------------------------------

function VariantSection({
  productId,
  variants,
}: {
  productId: string
  variants: Variant[]
}) {
  const [adding, setAdding] = React.useState(false)

  return (
    <section className="border border-cream-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm tracking-[0.1em]">規格與庫存</h2>
        {!adding && (
          <Button size="sm" variant="subtle" onClick={() => setAdding(true)}>
            <Plus size={14} />
            新增規格
          </Button>
        )}
      </div>

      {adding && (
        <AddVariantForm
          productId={productId}
          onDone={() => setAdding(false)}
          onCancel={() => setAdding(false)}
        />
      )}

      <DataTable headers={['SKU', '規格', '售價', '庫存', '已佔用', '可售', '啟用', '', '']}>
        {variants.map((variant) => (
          <VariantRow key={variant.id} variant={variant} canDelete={variants.length > 1} />
        ))}
      </DataTable>

      <p className="mt-3 text-xs text-taupe-500">
        「已佔用」是未付款訂單保留的數量，庫存不能調到低於這個數字。
        賣過的規格刪除時會自動改為停用，以保留歷史訂單的關聯。
      </p>
    </section>
  )
}

function AddVariantForm({
  productId,
  onDone,
  onCancel,
}: {
  productId: string
  onDone: () => void
  onCancel: () => void
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [state, formAction, pending] = useActionState(addVariant, INITIAL)

  React.useEffect(() => {
    if (state.ok) {
      toast(state.message ?? '規格已新增')
      onDone()
      router.refresh()
    }
    if (state.error) toast(state.error, 'error')
  }, [state, toast, onDone, router])

  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction} className="mb-5 border border-cream-300 bg-cream-50 p-4">
      <input type="hidden" name="productId" value={productId} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="規格名稱" htmlFor="new-name" required error={errors.name}>
          <Input id="new-name" name="name" placeholder="L" maxLength={60} required />
        </Field>
        <Field label="SKU" htmlFor="new-sku" error={errors.sku} hint="留白自動產生">
          <Input id="new-sku" name="sku" className="font-mono" maxLength={64} />
        </Field>
        <Field label="售價" htmlFor="new-price" required error={errors.price}>
          <Input id="new-price" name="price" type="number" min={0} defaultValue={0} required />
        </Field>
        <Field label="庫存" htmlFor="new-stock" required error={errors.stock}>
          <Input id="new-stock" name="stock" type="number" min={0} defaultValue={0} required />
        </Field>
      </div>

      <div className="mt-4 flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? '新增中…' : '新增'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          <X size={14} />
          取消
        </Button>
      </div>
    </form>
  )
}

function VariantRow({ variant, canDelete }: { variant: Variant; canDelete: boolean }) {
  const router = useRouter()
  const { toast } = useToast()
  const [price, setPrice] = React.useState(variant.price)
  const [stock, setStock] = React.useState(variant.stock)
  const [isActive, setIsActive] = React.useState(variant.isActive)
  const [pending, setPending] = React.useState(false)

  const dirty =
    price !== variant.price || stock !== variant.stock || isActive !== variant.isActive

  async function save() {
    setPending(true)
    const result = await updateVariant({ variantId: variant.id, price, stock, isActive })
    setPending(false)

    if (!result.ok) {
      toast(result.error ?? '更新失敗', 'error')
      return
    }
    toast(`${variant.name} 已更新`)
    router.refresh()
  }

  async function remove() {
    if (!window.confirm(`確定要刪除規格「${variant.name}」嗎？`)) return
    setPending(true)
    const result = await deleteVariant(variant.id)
    setPending(false)

    if (!result.ok) {
      toast(result.error ?? '刪除失敗', 'error')
      return
    }
    toast(result.message ?? '已刪除')
    router.refresh()
  }

  const available = Math.max(0, stock - variant.reservedStock)

  return (
    <tr className={cn(!isActive && 'opacity-50')}>
      <Td className="font-mono text-xs text-taupe-500">{variant.sku}</Td>
      <Td>{variant.name}</Td>
      <Td>
        <input
          type="number"
          min={0}
          value={price}
          onChange={(e) => setPrice(Number(e.target.value))}
          className="w-24 border border-cream-300 px-2 py-1 text-sm tabular-nums focus:border-taupe-500 focus:outline-none"
        />
        <span className="ml-1 text-xs text-taupe-400">{formatTWD(price)}</span>
      </Td>
      <Td>
        <input
          type="number"
          min={0}
          value={stock}
          onChange={(e) => setStock(Number(e.target.value))}
          className="w-20 border border-cream-300 px-2 py-1 text-sm tabular-nums focus:border-taupe-500 focus:outline-none"
        />
      </Td>
      <Td className="tabular-nums text-taupe-600">{variant.reservedStock}</Td>
      <Td className={cn('tabular-nums', available === 0 && 'text-sale')}>{available}</Td>
      <Td>
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          aria-label="啟用這個規格"
          className="size-3.5 accent-[#2b2724]"
        />
      </Td>
      <Td>
        <Button size="sm" variant="subtle" disabled={!dirty || pending} onClick={save}>
          {pending ? '…' : '儲存'}
        </Button>
      </Td>
      <Td>
        {canDelete && (
          <button
            type="button"
            aria-label="刪除規格"
            title="刪除規格"
            disabled={pending}
            onClick={remove}
            className="text-taupe-400 transition-colors hover:text-sale disabled:text-taupe-300"
          >
            <Trash2 size={14} />
          </button>
        )}
      </Td>
    </tr>
  )
}
