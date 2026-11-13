import { getTranslations } from 'next-intl/server'
import { ArrowRight } from 'lucide-react'
import { Link } from '@/i18n/routing'
import { formatTWD } from '@/lib/utils'
import type { StorefrontBundle } from '@/lib/bundles'

/**
 * 商品頁的「組合購買更划算」：這件商品出現在哪些組合裡、各省多少。
 * 放在加入購物車按鈕正下方，顧客決定要買之前就看得到。
 */
export async function ProductBundleHint({
  bundles,
  productId,
}: {
  bundles: StorefrontBundle[]
  productId: string
}) {
  if (bundles.length === 0) return null
  const t = await getTranslations('bundles')

  return (
    <section
      aria-labelledby="product-bundle-hint"
      className="mt-6 border border-sale/30 bg-sale/[0.03] px-4 py-4"
    >
      <h2 id="product-bundle-hint" className="text-sm font-medium tracking-wide text-sale">
        {t('productHintTitle')}
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-taupe-600">{t('productHintBody')}</p>

      <ul className="mt-3 space-y-2">
        {bundles.map((bundle) => {
          // 其他一起搭配的商品，讓顧客一眼看出「跟什麼一起買」
          const others = bundle.items
            .filter((item) => item.productId !== productId)
            .map((item) => item.productName)
          return (
            <li key={bundle.id}>
              <Link
                href={`/bundles/${bundle.slug}`}
                className="group flex items-center gap-3 bg-white px-3 py-2.5 transition-colors hover:bg-cream-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-ink-900">{bundle.name}</span>
                  {others.length > 0 && (
                    <span className="mt-0.5 block truncate text-xs text-taupe-500">
                      {t('withItems', { items: others.join('、') })}
                    </span>
                  )}
                  <span className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs">
                    <span className="tabular-nums text-sale">
                      {t('bundlePrice')} {formatTWD(bundle.price)}
                    </span>
                    <span className="tabular-nums text-taupe-400 line-through">
                      {formatTWD(bundle.originalMin)}
                    </span>
                    {bundle.saving > 0 && (
                      <span className="text-sale">
                        {t(bundle.originalMax > bundle.originalMin ? 'savingFrom' : 'saving', {
                          amount: formatTWD(bundle.saving),
                        })}
                      </span>
                    )}
                  </span>
                </span>
                <ArrowRight
                  size={15}
                  aria-hidden
                  className="shrink-0 text-taupe-500 transition-transform group-hover:translate-x-0.5"
                />
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
