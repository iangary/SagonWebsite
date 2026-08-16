import Image from 'next/image'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/routing'
import { Reveal } from '@/components/ui/reveal'
import { Badge } from '@/components/ui/badge'
import { formatTWD } from '@/lib/utils'
import { isPurchasable, type ProductCardData } from '@/lib/catalog/queries'
import { localizedName } from '@/lib/i18n/localized'

export function ProductCard({
  product,
  priority = false,
}: {
  product: ProductCardData
  priority?: boolean
}) {
  const t = useTranslations('product')
  const locale = useLocale()
  const name = localizedName(locale, product)
  const [primary, secondary] = product.images
  const available = isPurchasable(product)
  const onSale = product.compareAtPrice !== null && product.compareAtPrice > product.basePrice

  return (
    <Link href={`/product/${product.slug}`} className="group block">
      <div className="relative aspect-[3/4] overflow-hidden bg-cream-100">
        {primary ? (
          <>
            <Image
              src={primary.url}
              alt={primary.alt ?? name}
              fill
              sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
              priority={priority}
              className="object-cover transition-[opacity,transform] duration-500 ease-out group-hover:scale-105 group-hover:opacity-0"
            />
            {/* 第二張圖預先疊在下面，hover 時淡入，不需要等載入 */}
            {secondary && (
              <Image
                src={secondary.url}
                alt=""
                fill
                sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                aria-hidden
                className="object-cover opacity-0 transition-[opacity,transform] duration-500 ease-out group-hover:scale-105 group-hover:opacity-100"
              />
            )}
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-taupe-400">
            {t('noImage')}
          </div>
        )}

        <div className="absolute left-3 top-3 flex flex-col gap-1.5">
          {onSale && <Badge tone="sale">{t('sale')}</Badge>}
          {!available && <Badge tone="muted">{t('soldOut')}</Badge>}
        </div>
      </div>

      <div className="pt-3">
        {product.brand && (
          <p className="text-[11px] tracking-[0.12em] text-taupe-500 uppercase">
            {product.brand.name}
          </p>
        )}
        <h3 className="mt-1 line-clamp-2 text-sm leading-relaxed text-ink-900 transition-colors group-hover:text-taupe-600">
          {name}
        </h3>
        <p className="mt-1.5 flex items-baseline gap-2 text-sm">
          <span className={onSale ? 'text-sale' : 'text-ink-900'}>
            {formatTWD(product.basePrice)}
          </span>
          {onSale && (
            <span className="text-xs text-taupe-400 line-through">
              {formatTWD(product.compareAtPrice!)}
            </span>
          )}
        </p>
      </div>
    </Link>
  )
}

export function ProductGrid({
  products,
  priorityCount = 4,
}: {
  products: ProductCardData[]
  priorityCount?: number
}) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
      {products.map((product, i) => (
        // 延遲用 i % 4：同一排的卡片做出時間差，跨排進場時不會等前面整串跑完
        <Reveal key={product.id} delay={(i % 4) * 60}>
          <ProductCard product={product} priority={i < priorityCount} />
        </Reveal>
      ))}
    </div>
  )
}
