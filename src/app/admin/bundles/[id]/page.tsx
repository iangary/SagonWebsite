import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { db } from '@/lib/db'
import { BundleForm } from '../bundle-form'
import { loadBundleProductOptions } from '../product-options'

export const dynamic = 'force-dynamic'
export const metadata = { title: '編輯組合' }

export default async function EditBundlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const bundle = await db.bundle.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      name: true,
      nameEn: true,
      description: true,
      descriptionEn: true,
      price: true,
      sortOrder: true,
      isActive: true,
      items: {
        orderBy: { sortOrder: 'asc' },
        select: { productId: true, variantId: true, qty: true },
      },
    },
  })
  if (!bundle) notFound()

  const products = await loadBundleProductOptions(bundle.items.map((item) => item.productId))

  return (
    <>
      <Link
        href="/admin/bundles"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-taupe-600 hover:text-ink-900"
      >
        <ArrowLeft size={14} />
        回組合列表
      </Link>

      <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl tracking-[0.1em]">{bundle.name}</h1>
        {bundle.isActive && (
          <a
            href={`/bundles/${bundle.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-taupe-600 hover:text-ink-900"
          >
            看前台頁面
            <ExternalLink size={13} />
          </a>
        )}
      </div>

      <BundleForm
        // 儲存後 router.refresh() 帶回新資料，key 換掉才會重設表單內的 state
        key={JSON.stringify(bundle)}
        products={products}
        initial={{
          id: bundle.id,
          name: bundle.name,
          nameEn: bundle.nameEn ?? '',
          slug: bundle.slug,
          description: bundle.description ?? '',
          descriptionEn: bundle.descriptionEn ?? '',
          price: bundle.price,
          sortOrder: bundle.sortOrder,
          isActive: bundle.isActive,
          items: bundle.items,
        }}
      />
    </>
  )
}
