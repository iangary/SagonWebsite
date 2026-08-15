'use client'

import * as React from 'react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Minus, Plus, Trash2, ShoppingBag, Tag } from 'lucide-react'
import { Link } from '@/i18n/routing'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { useCartCount } from '@/components/cart/cart-count-provider'
import { updateCartItemQty, removeCartItem, applyCoupon } from '@/lib/cart/actions'
import type { PricingResult } from '@/lib/orders/pricing'
import { formatTWD } from '@/lib/utils'

type CartItemView = {
  id: string
  qty: number
  variantId: string
  variantName: string
  available: number
  unitPrice: number
  productName: string
  productSlug: string
  brandName: string | null
  imageUrl: string | null
}

export function CartView({
  items,
  pricing,
  couponCode,
  freeShippingThreshold,
}: {
  items: CartItemView[]
  pricing: PricingResult
  couponCode: string | null
  freeShippingThreshold: number
}) {
  const t = useTranslations('cart')
  const router = useRouter()
  const { toast } = useToast()
  const { setCount } = useCartCount()
  const [pending, setPending] = React.useState<string | null>(null)

  async function changeQty(itemId: string, qty: number) {
    setPending(itemId)
    const result = await updateCartItemQty(itemId, qty)
    setPending(null)
    if (!result.ok) {
      toast(result.error, 'error')
      return
    }
    setCount(result.count)
    router.refresh()
  }

  async function remove(itemId: string) {
    setPending(itemId)
    const result = await removeCartItem(itemId)
    setPending(null)
    if (!result.ok) {
      toast(result.error, 'error')
      return
    }
    setCount(result.count)
    router.refresh()
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-6 py-28 text-center">
        {/* 空狀態也要有 h1 —— 每頁一個 h1 是無障礙與 SEO 的底線 */}
        <h1 className="sr-only">{t('title')}</h1>
        <ShoppingBag size={40} strokeWidth={1} className="text-taupe-400" />
        <p className="mt-6 text-ink-700">{t('empty')}</p>
        <Button asChild className="mt-8">
          <Link href="/product/all">{t('emptyCta')}</Link>
        </Button>
      </div>
    )
  }

  const shortfall = Math.max(0, freeShippingThreshold - (pricing.subtotal - pricing.discountTotal))

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="text-2xl tracking-[0.12em]">{t('title')}</h1>

      <div className="mt-10 gap-12 lg:flex lg:items-start">
        <ul className="flex-1 divide-y divide-cream-200 border-y border-cream-200">
          {items.map((item) => (
            <li key={item.id} className="flex gap-4 py-6">
              <Link
                href={`/product/${item.productSlug}`}
                className="relative size-24 shrink-0 overflow-hidden bg-cream-100 sm:size-28"
              >
                {item.imageUrl && (
                  <Image
                    src={item.imageUrl}
                    alt={item.productName}
                    fill
                    sizes="112px"
                    className="object-cover"
                  />
                )}
              </Link>

              <div className="flex flex-1 flex-col justify-between gap-3">
                <div>
                  {item.brandName && (
                    <p className="text-[11px] tracking-[0.12em] text-taupe-500 uppercase">
                      {item.brandName}
                    </p>
                  )}
                  <Link
                    href={`/product/${item.productSlug}`}
                    className="mt-0.5 block text-sm text-ink-900 hover:text-taupe-600"
                  >
                    {item.productName}
                  </Link>
                  <p className="mt-1 text-xs text-taupe-500">{item.variantName}</p>
                  {item.available < item.qty && (
                    <p className="mt-1 text-xs text-sale">
                      {t('lowStockWarning', { count: item.available })}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="inline-flex items-center border border-cream-300">
                    <button
                      onClick={() => changeQty(item.id, item.qty - 1)}
                      disabled={pending === item.id || item.qty <= 1}
                      aria-label={t('decreaseQty')}
                      className="flex size-9 items-center justify-center text-ink-700 hover:bg-cream-100 disabled:text-taupe-300"
                    >
                      <Minus size={13} />
                    </button>
                    <span className="w-10 text-center text-sm tabular-nums">{item.qty}</span>
                    <button
                      onClick={() => changeQty(item.id, item.qty + 1)}
                      disabled={pending === item.id || item.qty >= item.available}
                      aria-label={t('increaseQty')}
                      className="flex size-9 items-center justify-center text-ink-700 hover:bg-cream-100 disabled:text-taupe-300"
                    >
                      <Plus size={13} />
                    </button>
                  </div>

                  <div className="flex items-center gap-4">
                    <span className="text-sm tabular-nums text-ink-900">
                      {formatTWD(item.unitPrice * item.qty)}
                    </span>
                    <button
                      onClick={() => remove(item.id)}
                      disabled={pending === item.id}
                      aria-label={t('remove')}
                      className="text-taupe-400 transition-colors hover:text-sale"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <aside className="mt-10 lg:mt-0 lg:w-80 lg:shrink-0">
          <div className="bg-cream-100 p-6">
            <CouponForm
              currentCode={couponCode}
              error={pricing.couponError}
              onApplied={() => router.refresh()}
            />

            <dl className="mt-6 space-y-2.5 border-t border-cream-200 pt-5 text-sm">
              <Row label={t('subtotal')} value={formatTWD(pricing.subtotal)} />
              {pricing.discountTotal > 0 && (
                <Row
                  label={t('discount')}
                  value={`-${formatTWD(pricing.discountTotal)}`}
                  tone="sale"
                />
              )}
              <Row
                label={t('shipping')}
                value={
                  pricing.shippingFee === 0 ? t('freeShipping') : formatTWD(pricing.shippingFee)
                }
              />
            </dl>

            {shortfall > 0 && (
              <p className="mt-3 text-xs text-taupe-600">
                {t('freeShippingHint', { amount: formatTWD(shortfall) })}
              </p>
            )}

            <dl className="mt-5 border-t border-cream-200 pt-5">
              <div className="flex items-baseline justify-between">
                <dt className="text-sm">{t('total')}</dt>
                <dd className="text-xl tabular-nums">{formatTWD(pricing.grandTotal)}</dd>
              </div>
              <p className="mt-1.5 text-xs text-taupe-500">{t('shippingNote')}</p>
            </dl>

            <Button asChild size="lg" full className="mt-6">
              <Link href="/checkout">{t('checkout')}</Link>
            </Button>
          </div>

          <Link
            href="/product/all"
            className="mt-4 block text-center text-xs text-taupe-600 underline underline-offset-4 hover:text-ink-900"
          >
            {t('continueShopping')}
          </Link>
        </aside>
      </div>
    </div>
  )
}

function Row({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'sale'
}) {
  return (
    <div className="flex justify-between">
      <dt className="text-ink-700">{label}</dt>
      <dd className={`tabular-nums ${tone === 'sale' ? 'text-sale' : 'text-ink-900'}`}>{value}</dd>
    </div>
  )
}

function CouponForm({
  currentCode,
  error,
  onApplied,
}: {
  currentCode: string | null
  error: string | null
  onApplied: () => void
}) {
  const t = useTranslations('cart')
  const { toast } = useToast()
  const [code, setCode] = React.useState(currentCode ?? '')
  const [pending, setPending] = React.useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    const result = await applyCoupon(code)
    setPending(false)

    if (!result.ok) {
      toast(result.error ?? t('couponFailed'), 'error')
      return
    }
    onApplied()
  }

  return (
    <form onSubmit={submit}>
      <label
        htmlFor="coupon"
        className="mb-2 flex items-center gap-1.5 text-xs tracking-wide text-taupe-600"
      >
        <Tag size={13} />
        {t('couponCode')}
      </label>
      <div className="flex gap-2">
        <Input
          id="coupon"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder={t('couponPlaceholder')}
          aria-invalid={Boolean(error)}
          className="flex-1"
        />
        <Button type="submit" variant="subtle" disabled={pending}>
          {t('applyCoupon')}
        </Button>
      </div>
      {error && <p className="mt-1.5 text-xs text-sale">{error}</p>}
      {currentCode && !error && (
        <p className="mt-1.5 text-xs text-taupe-600">
          {t('couponAppliedCode', { code: currentCode })}
        </p>
      )}
    </form>
  )
}
