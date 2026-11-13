'use client'

import * as React from 'react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { ShoppingBag } from 'lucide-react'
import { Link, useRouter } from '@/i18n/routing'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { useCartCount } from '@/components/cart/cart-count-provider'
import { addBundleToCart } from '@/lib/bundles/actions'
import { formatTWD } from '@/lib/utils'
import type { StorefrontBundle, StorefrontBundleVariant } from '@/lib/bundles'

function canBuy(variant: StorefrontBundleVariant, qty = 1): boolean {
  return variant.preorder || variant.available >= qty
}

/**
 * 組合頁的「選規格 + 加入購物車」。
 *
 * 這裡算的金額只是給顧客看的預覽；實際折多少由購物車與結帳時伺服器重算。
 * 「任一規格」的項目數量 2 以上時，每一件各給一個選單（可以一件 M、一件 L）。
 */
export function BundleBuilder({ bundle }: { bundle: StorefrontBundle }) {
  const t = useTranslations('bundles')
  const router = useRouter()
  const { toast } = useToast()
  const { setCount } = useCartCount()
  const [pending, setPending] = React.useState(false)

  // 每個項目、每一件選了哪個規格。只有一個可買的規格就直接幫忙選好
  const [choices, setChoices] = React.useState<Record<string, (string | null)[]>>(() =>
    Object.fromEntries(
      bundle.items.map((item) => {
        const buyable = item.variants.filter((v) => canBuy(v))
        const preset = item.fixedVariant || buyable.length === 1 ? (buyable[0]?.id ?? null) : null
        return [item.id, Array.from({ length: item.qty }, () => preset)]
      }),
    ),
  )

  const complete = bundle.items.every((item) => choices[item.id]?.every(Boolean))
  const original = bundle.items.reduce((sum, item) => {
    return (
      sum +
      (choices[item.id] ?? []).reduce((s, id) => {
        const v = item.variants.find((x) => x.id === id)
        return s + (v ? v.price : Math.min(...item.variants.map((x) => x.price)))
      }, 0)
    )
  }, 0)
  const saving = Math.max(0, original - bundle.price)

  function choose(itemId: string, index: number, variantId: string) {
    setChoices((current) => {
      const next = [...(current[itemId] ?? [])]
      next[index] = variantId || null
      return { ...current, [itemId]: next }
    })
  }

  async function submit() {
    if (!complete) {
      toast(t('selectAll'), 'error')
      return
    }
    setPending(true)
    const result = await addBundleToCart(
      bundle.id,
      bundle.items
        .filter((item) => !item.fixedVariant)
        .map((item) => ({ itemId: item.id, variantIds: choices[item.id] as string[] })),
    )
    setPending(false)
    if (!result.ok) {
      toast(result.error, 'error')
      return
    }
    setCount(result.count)
    toast(t('addedBundle'))
    router.push('/cart')
  }

  return (
    <div>
      <h2 className="text-sm tracking-[0.12em]">{t('contents')}</h2>
      <ul className="mt-4 divide-y divide-cream-200 border-y border-cream-200">
        {bundle.items.map((item) => (
          <li key={item.id} className="flex gap-4 py-5">
            <Link
              href={`/product/${item.productSlug}`}
              className="relative size-20 shrink-0 overflow-hidden bg-cream-100"
            >
              {item.imageUrl && (
                <Image
                  src={item.imageUrl}
                  alt={item.productName}
                  fill
                  sizes="80px"
                  className="object-cover"
                />
              )}
            </Link>
            <div className="min-w-0 flex-1">
              <Link
                href={`/product/${item.productSlug}`}
                className="text-sm leading-relaxed text-ink-900 hover:text-taupe-600"
              >
                {item.productName}
              </Link>
              <span className="ml-1.5 text-xs text-taupe-500">
                {t('itemQty', { count: item.qty })}
              </span>

              {item.fixedVariant ? (
                <p className="mt-1 text-xs text-taupe-600">
                  {t('fixedVariantLabel')}
                  {item.variants[0]?.name}
                  {item.variants[0] && !canBuy(item.variants[0], item.qty) && (
                    <span className="ml-1 text-sale">{t('outOfStockOption')}</span>
                  )}
                </p>
              ) : (
                <div className="mt-2 space-y-2">
                  {(choices[item.id] ?? []).map((value, index) => (
                    <Select
                      key={index}
                      value={value ?? ''}
                      onChange={(e) => choose(item.id, index, e.target.value)}
                      aria-label={
                        item.qty > 1
                          ? t('chooseVariantNth', { name: item.productName, n: index + 1 })
                          : t('chooseVariantFor', { name: item.productName })
                      }
                      className="max-w-xs"
                    >
                      <option value="">{t('chooseVariant')}</option>
                      {item.variants.map((v) => (
                        <option key={v.id} value={v.id} disabled={!canBuy(v)}>
                          {v.name} · {formatTWD(v.price)}
                          {v.available <= 0 &&
                            (v.preorder ? t('preorderOption') : t('outOfStockOption'))}
                        </option>
                      ))}
                    </Select>
                  ))}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>

      <dl className="mt-6 space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-ink-700">{t('originalTotal')}</dt>
          <dd className="tabular-nums text-taupe-500 line-through">{formatTWD(original)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-700">{t('bundlePrice')}</dt>
          <dd className="text-lg tabular-nums text-sale">{formatTWD(bundle.price)}</dd>
        </div>
      </dl>
      {saving > 0 && (
        <p className="mt-2 text-right">
          <span className="border border-sale/40 bg-sale/5 px-2 py-0.5 text-xs tracking-wide text-sale">
            {t('saving', { amount: formatTWD(saving) })}
          </span>
        </p>
      )}

      <Button
        size="lg"
        full
        className="mt-6"
        disabled={pending || !bundle.purchasable}
        onClick={submit}
      >
        <ShoppingBag size={16} />
        {bundle.purchasable ? t('addBundle') : t('soldOut')}
      </Button>
      <p className="mt-3 text-xs leading-relaxed text-taupe-600">{t('autoApplyNote')}</p>
    </div>
  )
}
