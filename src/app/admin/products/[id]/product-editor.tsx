'use client'

import * as React from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Textarea, Select, Field } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { DataTable, Td } from '@/components/admin/ui'
import { updateProduct, updateVariant, type ProductFormState } from '../actions'
import { formatTWD } from '@/lib/utils'

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
  variants,
  categories,
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
  variants: Variant[]
  categories: string[]
}) {
  const { toast } = useToast()
  const [state, formAction, pending] = useActionState(updateProduct, INITIAL)

  React.useEffect(() => {
    if (state.ok && state.message) toast(state.message)
    if (state.error) toast(state.error, 'error')
  }, [state, toast])

  const errors = state.fieldErrors ?? {}

  return (
    <div className="space-y-8">
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

        {categories.length > 0 && (
          <p className="mt-4 text-xs text-taupe-500">分類：{categories.join('、')}</p>
        )}

        <div className="mt-6 flex justify-end">
          <Button type="submit" disabled={pending}>
            <Save size={15} />
            {pending ? '儲存中…' : '儲存'}
          </Button>
        </div>
      </form>

      <section className="border border-cream-200 bg-white p-5">
        <h2 className="mb-4 text-sm tracking-[0.1em]">規格與庫存</h2>
        <DataTable headers={['SKU', '規格', '售價', '庫存', '已佔用', '可售', '啟用', '']}>
          {variants.map((variant) => (
            <VariantRow key={variant.id} variant={variant} />
          ))}
        </DataTable>
        <p className="mt-3 text-xs text-taupe-500">
          「已佔用」是未付款訂單保留的數量。庫存不能調整到低於這個數字。
        </p>
      </section>
    </div>
  )
}

function VariantRow({ variant }: { variant: Variant }) {
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

  const available = Math.max(0, stock - variant.reservedStock)

  return (
    <tr>
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
      <Td className={`tabular-nums ${available === 0 ? 'text-sale' : ''}`}>{available}</Td>
      <Td>
        <input
          type="checkbox"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="size-3.5 accent-[#2b2724]"
        />
      </Td>
      <Td>
        <Button size="sm" variant="subtle" disabled={!dirty || pending} onClick={save}>
          {pending ? '…' : '儲存'}
        </Button>
      </Td>
    </tr>
  )
}
