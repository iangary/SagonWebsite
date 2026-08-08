import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { db } from '@/lib/db'
import { NewProductForm } from './new-product-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: '新增商品' }

export default async function NewProductPage() {
  const [brands, categories] = await Promise.all([
    db.brand.findMany({ orderBy: { sortOrder: 'asc' }, select: { id: true, name: true } }),
    db.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true },
    }),
  ])

  return (
    <>
      <Link
        href="/admin/products"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-taupe-600 hover:text-ink-900"
      >
        <ArrowLeft size={14} />
        回商品列表
      </Link>

      <h1 className="mb-2 text-xl tracking-[0.1em]">新增商品</h1>
      <p className="mb-8 text-sm text-taupe-600">
        建立後會進入編輯頁，可以上傳圖片、加入更多規格，確認無誤再上架。
      </p>

      <NewProductForm brands={brands} categories={categories} />
    </>
  )
}
