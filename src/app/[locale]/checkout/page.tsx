import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'
import { getCart } from '@/lib/cart'
import { localizedName } from '@/lib/i18n/localized'
import { shopConfig } from '@/lib/shop-config'
import { isCallbackReachable } from '@/lib/ecpay/config'
import { CheckoutForm } from './checkout-form'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'checkout' })
  return { title: t('title'), robots: { index: false } }
}

export default async function CheckoutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  const cart = await getCart()
  if (cart.items.length === 0) redirect('/cart')

  const session = await auth()

  const [t, defaultAddress] = await Promise.all([
    getTranslations('checkout'),
    session?.user?.id
      ? db.address.findFirst({
          where: { userId: session.user.id, isDefault: true },
        })
      : null,
  ])

  const items = cart.items.map((item) => ({
    id: item.id,
    qty: item.qty,
    unitPrice: item.variant.price,
    productName: localizedName(locale, item.variant.product),
    variantName: item.variant.name,
    imageUrl: item.variant.product.images[0]?.url ?? null,
  }))

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="text-2xl tracking-[0.12em]">{t('title')}</h1>

      {!isCallbackReachable() && (
        <div className="mt-6 border border-rose-accent/40 bg-rose-accent/5 px-4 py-3 text-sm text-ink-700">
          <p className="font-medium text-ink-900">{t('devWarningTitle')}</p>
          <p className="mt-1 leading-relaxed">
            {t('devWarningBody')}
            <br />
            <code className="mt-1 inline-block text-xs">
              docker compose --profile tunnel up -d cloudflared
            </code>
          </p>
        </div>
      )}

      <CheckoutForm
        items={items}
        couponCode={cart.couponCode}
        defaultEmail={session?.user?.email ?? ''}
        defaultAddress={
          defaultAddress
            ? {
                recipient: defaultAddress.recipient,
                phone: defaultAddress.phone,
                zip: defaultAddress.zip,
                city: defaultAddress.city,
                district: defaultAddress.district,
                line1: defaultAddress.line1,
              }
            : null
        }
        shippingFees={shopConfig.shippingFee}
        freeShippingThreshold={shopConfig.freeShippingThreshold}
      />
    </div>
  )
}
