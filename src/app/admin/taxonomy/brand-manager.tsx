'use client'

import * as React from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Textarea, Field } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { DataTable, Td } from '@/components/admin/ui'
import { saveBrand, deleteBrand, type TaxonomyState } from './actions'

type Brand = {
  id: string
  slug: string
  name: string
  description: string | null
  sortOrder: number
  _count: { products: number }
}

const INITIAL: TaxonomyState = { ok: false }

export function BrandManager({ brands }: { brands: Brand[] }) {
  const router = useRouter()
  const { toast } = useToast()
  const [editing, setEditing] = React.useState<Brand | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [pending, setPending] = React.useState(false)

  async function remove(brand: Brand) {
    if (!window.confirm(`確定要刪除品牌「${brand.name}」嗎？`)) return
    setPending(true)
    const result = await deleteBrand(brand.id)
    setPending(false)
    if (!result.ok) {
      toast(result.error ?? '刪除失敗', 'error')
      return
    }
    toast(result.message ?? '已刪除')
    router.refresh()
  }

  const showForm = creating || editing !== null

  return (
    <section data-testid="brand-manager">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base tracking-[0.1em]">品牌（{brands.length}）</h2>
        {!showForm && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus size={14} />
            新增品牌
          </Button>
        )}
      </div>

      {showForm && (
        <BrandForm
          brand={editing}
          onDone={() => {
            setEditing(null)
            setCreating(false)
            router.refresh()
          }}
          onCancel={() => {
            setEditing(null)
            setCreating(false)
          }}
        />
      )}

      <DataTable
        headers={['名稱', '說明', '網址', '商品數', '排序', '']}
        empty={brands.length === 0}
      >
        {brands.map((brand) => (
          <tr key={brand.id}>
            <Td>{brand.name}</Td>
            <Td className="max-w-72 text-xs text-taupe-600">
              <span className="line-clamp-2">{brand.description ?? '—'}</span>
            </Td>
            <Td className="font-mono text-xs text-taupe-500">{brand.slug}</Td>
            <Td className="tabular-nums">{brand._count.products}</Td>
            <Td className="tabular-nums text-taupe-600">{brand.sortOrder}</Td>
            <Td>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditing(brand)}>
                  <Pencil size={13} />
                  編輯
                </Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => remove(brand)}>
                  <Trash2 size={13} />
                  刪除
                </Button>
              </div>
            </Td>
          </tr>
        ))}
      </DataTable>

      <p className="mt-3 text-xs text-taupe-500">
        還有商品屬於這個品牌時無法刪除。品牌會出現在首頁的「品牌選購」區塊。
      </p>
    </section>
  )
}

function BrandForm({
  brand,
  onDone,
  onCancel,
}: {
  brand: Brand | null
  onDone: () => void
  onCancel: () => void
}) {
  const { toast } = useToast()
  const [state, formAction, pending] = useActionState(saveBrand, INITIAL)

  React.useEffect(() => {
    if (state.ok) {
      toast(state.message ?? '已儲存')
      onDone()
    }
    if (state.error) toast(state.error, 'error')
  }, [state, toast, onDone])

  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction} className="mb-5 border border-cream-300 bg-white p-5">
      <input type="hidden" name="id" value={brand?.id ?? ''} />
      <h3 className="mb-4 text-sm tracking-[0.1em]">
        {brand ? `編輯品牌：${brand.name}` : '新增品牌'}
      </h3>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="名稱" htmlFor="brand-name" required error={errors.name}>
          <Input
            id="brand-name"
            name="name"
            defaultValue={brand?.name}
            placeholder="LUNALUZ"
            required
          />
        </Field>

        <Field label="排序" htmlFor="brand-sortOrder" required hint="數字越小越前面">
          <Input
            id="brand-sortOrder"
            name="sortOrder"
            type="number"
            min={0}
            defaultValue={brand?.sortOrder ?? 0}
            required
          />
        </Field>

        <div className="sm:col-span-3">
          <Field
            label="說明"
            htmlFor="brand-description"
            hint="顯示在「關於」頁的品牌清單"
          >
            <Textarea
              id="brand-description"
              name="description"
              defaultValue={brand?.description ?? ''}
              maxLength={300}
            />
          </Field>
        </div>
      </div>

      {brand && (
        <p className="mt-3 text-xs text-taupe-500">
          網址 <span className="font-mono">{brand.slug}</span> 不可修改。
        </p>
      )}

      <div className="mt-5 flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? '儲存中…' : '儲存'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          <X size={14} />
          取消
        </Button>
      </div>
    </form>
  )
}
