import { db } from '@/lib/db'
import { PageHeader } from '@/components/admin/ui'
import { CategoryManager } from './category-manager'
import { BrandManager } from './brand-manager'

export const dynamic = 'force-dynamic'
export const metadata = { title: '分類與品牌' }

export default async function TaxonomyPage() {
  const [categories, brands] = await Promise.all([
    db.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        slug: true,
        name: true,
        nameEn: true,
        parentId: true,
        sortOrder: true,
        _count: { select: { products: true, children: true } },
      },
    }),
    db.brand.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        sortOrder: true,
        _count: { select: { products: true } },
      },
    }),
  ])

  return (
    <>
      <PageHeader
        title="分類與品牌"
        description="決定商品在前台如何被分群與導覽。排序數字越小越前面。"
      />

      <div className="space-y-8">
        <CategoryManager categories={categories} />
        <BrandManager brands={brands} />
      </div>
    </>
  )
}
