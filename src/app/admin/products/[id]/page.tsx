import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { db } from '@/lib/db'
import { MAX_FILES_PER_UPLOAD, MAX_UPLOAD_BYTES } from '@/lib/uploads'
import { ProductEditor } from './product-editor'
import { ImageManager } from './image-manager'
import { DangerZone } from './danger-zone'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const product = await db.product.findUnique({ where: { id }, select: { name: true } })
  return { title: product?.name ?? '商品' }
}

export default async function AdminProductDetail({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const [product, brands, categories] = await Promise.all([
    db.product.findUnique({
      where: { id },
      include: {
        images: { orderBy: { sortOrder: 'asc' } },
        variants: { orderBy: { sortOrder: 'asc' } },
        categories: { select: { categoryId: true } },
      },
    }),
    db.brand.findMany({ orderBy: { sortOrder: 'asc' }, select: { id: true, name: true } }),
    db.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true },
    }),
  ])

  if (!product) notFound()

  // 有銷售紀錄的商品不能真的刪除，先算出來讓 UI 能提前說明
  const soldCount = await db.orderItem.count({
    where: { variantId: { in: product.variants.map((v) => v.id) } },
  })

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <Link
          href="/admin/products"
          className="inline-flex items-center gap-1.5 text-sm text-taupe-600 hover:text-ink-900"
        >
          <ArrowLeft size={14} />
          回商品列表
        </Link>
        <a
          href={`/product/${product.slug}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-taupe-600 hover:text-ink-900"
        >
          在前台檢視
          <ExternalLink size={13} />
        </a>
      </div>

      <ProductEditor
        product={{
          id: product.id,
          name: product.name,
          summary: product.summary ?? '',
          status: product.status,
          brandId: product.brandId ?? '',
          seoTitle: product.seoTitle ?? '',
          seoDescription: product.seoDescription ?? '',
          slug: product.slug,
        }}
        brands={brands}
        allCategories={categories}
        selectedCategoryIds={product.categories.map((c) => c.categoryId)}
        variants={product.variants.map((v) => ({
          id: v.id,
          sku: v.sku,
          name: v.name,
          price: v.price,
          stock: v.stock,
          reservedStock: v.reservedStock,
          isActive: v.isActive,
        }))}
      />

      <div className="mt-6">
        <ImageManager
          productId={product.id}
          images={product.images.map((i) => ({
            id: i.id,
            url: i.url,
            width: i.width,
            height: i.height,
          }))}
          maxFiles={MAX_FILES_PER_UPLOAD}
          maxBytes={MAX_UPLOAD_BYTES}
        />
      </div>

      <div className="mt-6">
        <DangerZone productId={product.id} productName={product.name} soldCount={soldCount} />
      </div>
    </>
  )
}
