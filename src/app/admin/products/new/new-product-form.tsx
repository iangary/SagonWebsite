'use client'

import * as React from 'react'
import { useActionState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Textarea, Select, Field } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { createProduct, type ProductFormState } from '../actions'
import { formatTWD } from '@/lib/utils'

const INITIAL: ProductFormState = { ok: false }

export function NewProductForm({
  brands,
  categories,
}: {
  brands: { id: string; name: string }[]
  categories: { id: string; name: string }[]
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [state, formAction, pending] = useActionState(createProduct, INITIAL)

  const [price, setPrice] = React.useState(0)
  const [selectedCategories, setSelectedCategories] = React.useState<string[]>([])

  React.useEffect(() => {
    if (state.ok && state.redirectTo) {
      toast(state.message ?? '商品已建立')
      router.push(state.redirectTo)
    }
    if (state.error) toast(state.error, 'error')
  }, [state, toast, router])

  const errors = state.fieldErrors ?? {}

  function toggleCategory(id: string) {
    setSelectedCategories((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    )
  }

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="categoryIds" value={selectedCategories.join(',')} />

      <section className="border border-cream-200 bg-white p-5">
        <h2 className="mb-5 text-sm tracking-[0.1em]">基本資料</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="商品名稱" htmlFor="name" required error={errors.name}>
              <Input
                id="name"
                name="name"
                placeholder="例如：LUNALUZ 復古朱依紋睡衣套裝"
                required
              />
            </Field>
          </div>

          <div className="sm:col-span-2">
            <Field
              label="英文名稱"
              htmlFor="nameEn"
              hint="英文站顯示用，留白會直接顯示中文名"
            >
              <Input
                id="nameEn"
                name="nameEn"
                placeholder="LUNALUZ Vintage Floral Pajama Set"
                maxLength={200}
              />
            </Field>
          </div>

          <Field label="品牌" htmlFor="brandId">
            <Select id="brandId" name="brandId" defaultValue="">
              <option value="">未指定</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="上架狀態"
            htmlFor="status"
            required
            hint="建議先存成草稿，上傳圖片後再上架"
          >
            <Select id="status" name="status" defaultValue="DRAFT">
              <option value="DRAFT">草稿（前台看不到）</option>
              <option value="ACTIVE">直接上架</option>
            </Select>
          </Field>

          <div className="sm:col-span-2">
            <Field label="摘要" htmlFor="summary" hint="顯示在列表與分享預覽，建議 100 字內">
              <Textarea id="summary" name="summary" maxLength={500} />
            </Field>
          </div>

          <div className="sm:col-span-2">
            <Field
              label="商品描述"
              htmlFor="descriptionHtml"
              hint="支援 HTML。段落、粗體、清單都可以用。"
            >
              <Textarea
                id="descriptionHtml"
                name="descriptionHtml"
                className="min-h-40 font-mono text-xs"
                placeholder="<p>材質：100% 純棉</p>"
              />
            </Field>
          </div>
        </div>
      </section>

      <section className="border border-cream-200 bg-white p-5">
        <h2 className="mb-2 text-sm tracking-[0.1em]">第一個規格</h2>
        <p className="mb-5 text-xs text-taupe-500">
          每件商品至少要有一個規格。單一款式的商品留白即可（會命名為「單一規格」），
          有尺寸或顏色的話填 M、L、米白等，之後可在編輯頁繼續新增。
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="規格名稱" htmlFor="variantName" hint="留白 = 單一規格">
            <Input id="variantName" name="variantName" placeholder="M" maxLength={60} />
          </Field>

          <Field label="SKU" htmlFor="sku" error={errors.sku} hint="留白自動產生">
            <Input id="sku" name="sku" className="font-mono" maxLength={64} />
          </Field>

          <Field label="售價" htmlFor="price" required error={errors.price}>
            <Input
              id="price"
              name="price"
              type="number"
              min={0}
              defaultValue={0}
              onChange={(e) => setPrice(Number(e.target.value))}
              required
            />
          </Field>

          <Field label="庫存" htmlFor="stock" required error={errors.stock}>
            <Input id="stock" name="stock" type="number" min={0} defaultValue={0} required />
          </Field>

          <Field
            label="原價"
            htmlFor="compareAtPrice"
            hint="填了且高於售價才會顯示刪除線"
          >
            <Input id="compareAtPrice" name="compareAtPrice" type="number" min={0} />
          </Field>
        </div>

        {price > 0 && (
          <p className="mt-4 text-xs text-taupe-600">
            前台會顯示為 <span className="text-ink-900">{formatTWD(price)}</span>
          </p>
        )}
      </section>

      {categories.length > 0 && (
        <section className="border border-cream-200 bg-white p-5">
          <h2 className="mb-2 text-sm tracking-[0.1em]">分類</h2>
          <p className="mb-4 text-xs text-taupe-500">
            可以選多個。分類決定商品出現在哪些導覽頁面。
          </p>
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => {
              const active = selectedCategories.includes(category.id)
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => toggleCategory(category.id)}
                  aria-pressed={active}
                  className={
                    active
                      ? 'border border-ink-900 bg-ink-900 px-3 py-1.5 text-xs text-cream-50'
                      : 'border border-cream-300 px-3 py-1.5 text-xs text-ink-700 hover:border-taupe-400'
                  }
                >
                  {category.name}
                </button>
              )
            })}
          </div>
        </section>
      )}

      <div className="flex justify-end gap-2">
        <Button asChild variant="ghost">
          <Link href="/admin/products">取消</Link>
        </Button>
        <Button type="submit" disabled={pending || state.ok}>
          <Plus size={15} />
          {pending ? '建立中…' : state.ok ? '前往編輯頁…' : '建立商品'}
        </Button>
      </div>
    </form>
  )
}
