'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/routing'
import { Minus, Plus, ShoppingBag } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { useCartCount } from '@/components/cart/cart-count-provider'
import { addToCart } from '@/lib/cart/actions'
import { formatTWD, cn } from '@/lib/utils'

export type VariantOption = {
  id: string
  name: string
  price: number
  compareAtPrice: number | null
  available: number
}

const LOW_STOCK_THRESHOLD = 5

export function AddToCart({ variants }: { variants: VariantOption[] }) {
  const t = useTranslations('product')
  const router = useRouter()
  const { toast } = useToast()
  const { setCount } = useCartCount()

  // 只有一個規格時直接選好，不要逼使用者多點一下
  const [variantId, setVariantId] = React.useState<string | null>(
    variants.length === 1 ? variants[0]!.id : null,
  )
  const [qty, setQty] = React.useState(1)
  const [pending, setPending] = React.useState(false)

  const selected = variants.find((v) => v.id === variantId) ?? null
  const maxQty = selected ? Math.min(selected.available, 99) : 99
  const allSoldOut = variants.every((v) => v.available <= 0)

  // 換規格時把數量收回可買範圍內
  React.useEffect(() => {
    if (selected && qty > selected.available) setQty(Math.max(1, selected.available))
  }, [selected, qty])

  async function submit(thenCheckout: boolean) {
    if (!selected) {
      toast(t('selectVariant'), 'error')
      return
    }
    setPending(true)
    const result = await addToCart(selected.id, qty)
    setPending(false)

    if (!result.ok) {
      toast(result.error, 'error')
      return
    }

    setCount(result.count)
    if (thenCheckout) {
      router.push('/cart')
    } else {
      toast(t('addedToCart'))
    }
  }

  return (
    <div className="space-y-6">
      {variants.length > 1 && (
        <fieldset data-testid="variant-selector">
          <legend className="mb-2.5 text-xs tracking-wide text-taupe-600">
            {t('selectVariant')}
          </legend>
          <div className="flex flex-wrap gap-2">
            {variants.map((variant) => {
              const soldOut = variant.available <= 0
              const active = variant.id === variantId
              return (
                <button
                  key={variant.id}
                  onClick={() => !soldOut && setVariantId(variant.id)}
                  disabled={soldOut}
                  aria-pressed={active}
                  className={cn(
                    'min-w-14 border px-4 py-2 text-sm transition-colors',
                    soldOut && 'cursor-not-allowed border-cream-200 text-taupe-300 line-through',
                    !soldOut && active && 'border-ink-900 bg-ink-900 text-cream-50',
                    !soldOut && !active && 'border-cream-300 text-ink-700 hover:border-taupe-500',
                  )}
                >
                  {variant.name}
                </button>
              )
            })}
          </div>
        </fieldset>
      )}

      {selected && selected.available > 0 && selected.available <= LOW_STOCK_THRESHOLD && (
        <p className="text-xs text-sale">{t('lowStock', { count: selected.available })}</p>
      )}

      <div>
        <span className="mb-2.5 block text-xs tracking-wide text-taupe-600">{t('quantity')}</span>
        <div className="inline-flex items-center border border-cream-300">
          <QtyButton
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            disabled={qty <= 1 || allSoldOut}
            label={t('decreaseQty')}
          >
            <Minus size={14} />
          </QtyButton>
          <span className="w-12 text-center text-sm tabular-nums">{qty}</span>
          <QtyButton
            onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
            disabled={qty >= maxQty || allSoldOut}
            label={t('increaseQty')}
          >
            <Plus size={14} />
          </QtyButton>
        </div>
      </div>

      {selected && (
        <p className="text-lg">
          {t('lineSubtotal')}{' '}
          <span className="tabular-nums">{formatTWD(selected.price * qty)}</span>
        </p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          onClick={() => submit(false)}
          disabled={pending || allSoldOut}
          size="lg"
          full
          variant="outline"
        >
          <ShoppingBag size={16} />
          {allSoldOut ? t('outOfStock') : t('addToCart')}
        </Button>
        <Button onClick={() => submit(true)} disabled={pending || allSoldOut} size="lg" full>
          {t('buyNow')}
        </Button>
      </div>
    </div>
  )
}

function QtyButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void
  disabled: boolean
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex size-10 items-center justify-center text-ink-700 transition-colors hover:bg-cream-100 disabled:cursor-not-allowed disabled:text-taupe-300 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  )
}
