import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { BundleForm } from '../bundle-form'
import { loadBundleProductOptions } from '../product-options'

export const dynamic = 'force-dynamic'
export const metadata = { title: '新增組合' }

export default async function NewBundlePage() {
  const products = await loadBundleProductOptions()

  return (
    <>
      <Link
        href="/admin/bundles"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-taupe-600 hover:text-ink-900"
      >
        <ArrowLeft size={14} />
        回組合列表
      </Link>

      <h1 className="mb-2 text-xl tracking-[0.1em]">新增組合</h1>
      <p className="mb-8 text-sm text-taupe-600">
        選好組合內容與組合價。新組合預設不上架，確認無誤再勾選上架。
      </p>

      <BundleForm
        products={products}
        initial={{
          name: '',
          nameEn: '',
          slug: '',
          description: '',
          descriptionEn: '',
          price: '',
          sortOrder: 0,
          isActive: false,
          items: [],
        }}
      />
    </>
  )
}
