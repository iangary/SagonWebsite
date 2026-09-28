import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'
import { getCart, availableStock } from '@/lib/cart'
import { getShippingSettings, shippingFeesOf } from '@/lib/shop-settings'
import { localizedName } from '@/lib/i18n/localized'
import { calculatePricing } from '@/lib/orders/pricing'
import { currentPaymentInclude } from '@/lib/orders/payment'
import { CartView } from './cart-view'
import { PendingOrders } from './pending-orders'

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

  const [cart, session, shipping] = await Promise.all([getCart(), auth(), getShippingSettings()])

  const now = new Date()
  const [coupon, pendingOrders] = await Promise.all([
    cart.couponCode ? db.coupon.findUnique({ where: { code: cart.couponCode } }) : null,
    // 下單就清空購物車了，還沒付款的單要在這裡提醒，不然回來只看到空車
    session?.user?.id
      ? db.order.findMany({
          where: { userId: session.user.id, status: 'PENDING_PAYMENT' },
          orderBy: { createdAt: 'desc' },
          include: {
            items: true,
            payments: currentPaymentInclude,
            reservations: {
              where: { releasedAt: null, committedAt: null },
              select: { expiresAt: true },
            },
          },
        })
      : [],
  ])
  // 商品保留期限已過、只是排程還沒來得及取消的單，按下去也付不了，不必再催
  const payableOrders = pendingOrders.filter(
    (order) => !order.reservations.some((r) => r.expiresAt <= now),
  )

  // 購物車頁還不知道使用者要選哪種配送，先用超商運費估算
  const pricing = calculatePricing({
    lines: cart.items.map((i) => ({
      variantId: i.variantId,
      unitPrice: i.variant.price,
      qty: i.qty,
    })),
    shippingMethod: 'CVS',
    shippingFees: shippingFeesOf(shipping),
    freeShippingThreshold: shipping.freeShippingThreshold,
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
      freeShippingThreshold={shipping.freeShippingThreshold}
      isMember={Boolean(session?.user?.id)}
      pendingOrders={
        payableOrders.length > 0 ? <PendingOrders orders={payableOrders} /> : null
      }
    />
  )
}
