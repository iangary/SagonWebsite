import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { db } from '@/lib/db'
import { ProductEditor } from './product-editor'

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

  const [product, brands] = await Promise.all([
    db.product.findUnique({
      where: { id },
      include: {
        images: { orderBy: { sortOrder: 'asc' } },
        variants: { orderBy: { sortOrder: 'asc' } },
        categories: { include: { category: { select: { name: true } } } },
      },
    }),
    db.brand.findMany({ orderBy: { sortOrder: 'asc' }, select: { id: true, name: true } }),
  ])

  if (!product) notFound()

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
        variants={product.variants.map((v) => ({
          id: v.id,
          sku: v.sku,
          name: v.name,
          price: v.price,
          stock: v.stock,
          reservedStock: v.reservedStock,
          isActive: v.isActive,
        }))}
        categories={product.categories.map((c) => c.category.name)}
      />

      <section className="mt-8 border border-cream-200 bg-white p-5">
        <h2 className="mb-4 text-sm tracking-[0.1em]">商品圖片（{product.images.length}）</h2>
        <div className="flex flex-wrap gap-2">
          {product.images.map((image) => (
            <div key={image.id} className="relative size-20 overflow-hidden bg-cream-100">
              <Image src={image.url} alt="" fill sizes="80px" className="object-cover" />
            </div>
          ))}
          {product.images.length === 0 && (
            <p className="text-sm text-taupe-500">尚未上傳圖片</p>
          )}
        </div>
        <p className="mt-3 text-xs text-taupe-500">
          目前圖片來自 seed 資料。上傳與排序功能可在後續版本加入。
        </p>
      </section>
    </>
  )
}
