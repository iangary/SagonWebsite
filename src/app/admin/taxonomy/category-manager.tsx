'use client'

import * as React from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Pencil, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select, Field } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { DataTable, Td } from '@/components/admin/ui'
import { saveCategory, deleteCategory, type TaxonomyState } from './actions'

type Category = {
  id: string
  slug: string
  name: string
  nameEn: string | null
  parentId: string | null
  sortOrder: number
  _count: { products: number; children: number }
}

const INITIAL: TaxonomyState = { ok: false }

export function CategoryManager({ categories }: { categories: Category[] }) {
  const router = useRouter()
  const { toast } = useToast()
  const [editing, setEditing] = React.useState<Category | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [pending, setPending] = React.useState(false)

  async function remove(category: Category) {
    if (!window.confirm(`確定要刪除分類「${category.name}」嗎？`)) return
    setPending(true)
    const result = await deleteCategory(category.id)
    setPending(false)
    if (!result.ok) {
      toast(result.error ?? '刪除失敗', 'error')
      return
    }
    toast(result.message ?? '已刪除')
    router.refresh()
  }

  const showForm = creating || editing !== null
  const nameById = new Map(categories.map((c) => [c.id, c.name]))

  return (
    <section data-testid="category-manager">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base tracking-[0.1em]">分類（{categories.length}）</h2>
        {!showForm && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus size={14} />
            新增分類
          </Button>
        )}
      </div>

      {showForm && (
        <CategoryForm
          category={editing}
          categories={categories}
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
        headers={['名稱', '英文名', '上層分類', '網址', '商品數', '排序', '']}
        empty={categories.length === 0}
      >
        {categories.map((category) => (
          <tr key={category.id}>
            <Td>{category.name}</Td>
            <Td className="text-taupe-600">{category.nameEn ?? '—'}</Td>
            <Td className="text-taupe-600">
              {category.parentId ? (nameById.get(category.parentId) ?? '—') : '—'}
            </Td>
            <Td className="font-mono text-xs text-taupe-500">{category.slug}</Td>
            <Td className="tabular-nums">{category._count.products}</Td>
            <Td className="tabular-nums text-taupe-600">{category.sortOrder}</Td>
            <Td>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditing(category)}>
                  <Pencil size={13} />
                  編輯
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => remove(category)}
                >
                  <Trash2 size={13} />
                  刪除
                </Button>
              </div>
            </Td>
          </tr>
        ))}
      </DataTable>

      <p className="mt-3 text-xs text-taupe-500">
        分類底下還有商品或子分類時無法刪除。網址建立後不可修改。
      </p>
    </section>
  )
}

function CategoryForm({
  category,
  categories,
  onDone,
  onCancel,
}: {
  category: Category | null
  categories: Category[]
  onDone: () => void
  onCancel: () => void
}) {
  const { toast } = useToast()
  const [state, formAction, pending] = useActionState(saveCategory, INITIAL)

  React.useEffect(() => {
    if (state.ok) {
      toast(state.message ?? '已儲存')
      onDone()
    }
    if (state.error) toast(state.error, 'error')
  }, [state, toast, onDone])

  const errors = state.fieldErrors ?? {}

  // 編輯時不能把自己列為可選的上層分類
  const parentOptions = categories.filter((c) => c.id !== category?.id)

  return (
    <form action={formAction} className="mb-5 border border-cream-300 bg-white p-5">
      <input type="hidden" name="id" value={category?.id ?? ''} />
      <h3 className="mb-4 text-sm tracking-[0.1em]">
        {category ? `編輯分類：${category.name}` : '新增分類'}
      </h3>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="名稱" htmlFor="cat-name" required error={errors.name}>
          <Input
            id="cat-name"
            name="name"
            defaultValue={category?.name}
            placeholder="MMOM 睡衣"
            required
          />
        </Field>

        <Field label="英文名" htmlFor="cat-nameEn" hint="英文版導覽用，可留白">
          <Input id="cat-nameEn" name="nameEn" defaultValue={category?.nameEn ?? ''} />
        </Field>

        <Field label="上層分類" htmlFor="cat-parentId" error={errors.parentId}>
          <Select id="cat-parentId" name="parentId" defaultValue={category?.parentId ?? ''}>
            <option value="">（頂層）</option>
            {parentOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="排序" htmlFor="cat-sortOrder" required hint="數字越小越前面">
          <Input
            id="cat-sortOrder"
            name="sortOrder"
            type="number"
            min={0}
            defaultValue={category?.sortOrder ?? 0}
            required
          />
        </Field>
      </div>

      {category && (
        <p className="mt-3 text-xs text-taupe-500">
          網址 <span className="font-mono">{category.slug}</span> 不可修改。
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
