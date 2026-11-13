import Image from 'next/image'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/routing'
import { formatTWD } from '@/lib/utils'
import type { StorefrontBundle } from '@/lib/bundles'

/** 組合的價格標示：組合價、劃掉的原價、現省多少。列表、組合頁、商品頁共用。 */
export async function BundlePriceTag({
  bundle,
  size = 'md',
}: {
  bundle: Pick<StorefrontBundle, 'price' | 'originalMin' | 'originalMax' | 'saving'>
  size?: 'sm' | 'md' | 'lg'
}) {
  const t = await getTranslations('bundles')
  const varies = bundle.originalMax > bundle.originalMin
  const priceClass = size === 'lg' ? 'text-2xl' : size === 'md' ? 'text-lg' : 'text-base'

  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className={`${priceClass} tabular-nums text-sale`}>
        <span className="sr-only">{t('bundlePrice')} </span>
        {formatTWD(bundle.price)}
      </span>
      <span className="text-sm tabular-nums text-taupe-400 line-through">
        <span className="sr-only">{t('originalTotal')} </span>
        {formatTWD(bundle.originalMin)}
        {varies && ` – ${formatTWD(bundle.originalMax)}`}
      </span>
      {bundle.saving > 0 && (
        <span className="border border-sale/40 bg-sale/5 px-2 py-0.5 text-xs tracking-wide text-sale">
          {t(varies ? 'savingFrom' : 'saving', { amount: formatTWD(bundle.saving) })}
        </span>
      )}
    </div>
  )
}

/** 組合縮圖：把組合內每件商品的第一張圖拼成一格。 */
export function BundleThumbs({ bundle, sizes }: { bundle: StorefrontBundle; sizes: string }) {
  const images = bundle.items
    .map((item) => ({ url: item.imageUrl, alt: item.productName }))
    .filter((img): img is { url: string; alt: string } => Boolean(img.url))
    .slice(0, 4)

  return (
    <div
      className={`grid aspect-square overflow-hidden bg-cream-100 ${images.length > 1 ? 'grid-cols-2 gap-px' : ''}`}
    >
      {images.map((img, i) => (
        <div
          key={`${img.url}-${i}`}
          className={`relative ${images.length === 3 && i === 0 ? 'row-span-2' : ''}`}
        >
          <Image src={img.url} alt={img.alt} fill sizes={sizes} className="object-cover" />
        </div>
      ))}
    </div>
  )
}

export async function BundleCard({ bundle }: { bundle: StorefrontBundle }) {
  const t = await getTranslations('bundles')

  return (
    <Link href={`/bundles/${bundle.slug}`} className="group block">
      <BundleThumbs bundle={bundle} sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 90vw" />
      <h2 className="mt-4 text-base leading-relaxed text-ink-900 group-hover:text-taupe-600">
        {bundle.name}
      </h2>
      <ul className="mt-1.5 space-y-0.5 text-xs leading-relaxed text-taupe-600">
        {bundle.items.map((item) => (
          <li key={item.id}>
            {item.productName}
            {item.fixedVariant && item.variants[0] && (
              <span className="text-taupe-400">（{item.variants[0].name}）</span>
            )}
            <span className="text-taupe-400"> {t('itemQty', { count: item.qty })}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3">
        <BundlePriceTag bundle={bundle} />
      </div>
      {!bundle.purchasable && <p className="mt-2 text-xs text-sale">{t('soldOut')}</p>}
    </Link>
  )
}
