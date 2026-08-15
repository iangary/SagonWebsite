import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { db } from '@/lib/db'
import { getCart, availableStock } from '@/lib/cart'
import { shopConfig } from '@/lib/shop-config'
import { localizedName } from '@/lib/i18n/localized'
import { calculatePricing } from '@/lib/orders/pricing'
import { CartView } from './cart-view'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'cart' })
  return { title: t('title'), robots: { index: false } }
}

export default async function CartPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  const cart = await getCart()

  const coupon = cart.couponCode
    ? await db.coupon.findUnique({ where: { code: cart.couponCode } })
    : null

  // 購物車頁還不知道使用者要選哪種配送，先用超商運費估算
  const pricing = calculatePricing({
    lines: cart.items.map((i) => ({
      variantId: i.variantId,
      unitPrice: i.variant.price,
      qty: i.qty,
    })),
    shippingMethod: 'CVS',
    shippingFees: shopConfig.shippingFee,
    freeShippingThreshold: shopConfig.freeShippingThreshold,
    coupon,
  })

  const items = cart.items.map((item) => ({
    id: item.id,
    qty: item.qty,
    variantId: item.variantId,
    variantName: item.variant.name,
    available: availableStock(item.variant),
    unitPrice: item.variant.price,
    productName: localizedName(locale, item.variant.product),
    productSlug: item.variant.product.slug,
    brandName: item.variant.product.brand?.name ?? null,
    imageUrl: item.variant.product.images[0]?.url ?? null,
  }))

  return (
    <CartView
      items={items}
      pricing={pricing}
      couponCode={cart.couponCode}
      freeShippingThreshold={shopConfig.freeShippingThreshold}
    />
  )
}
