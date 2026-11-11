import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { auth } from '@/lib/auth'
import { getCart, isPreorderLine } from '@/lib/cart'
import { localizedName } from '@/lib/i18n/localized'
import { isCallbackReachable } from '@/lib/ecpay/config'
import {
  availableShippingMethods,
  getPaymentSettings,
  getShippingSettings,
  isBankTransferAvailable,
  shippingFeesOf,
} from '@/lib/shop-settings'
import { CHECKOUT_LOGIN_REDIRECT } from '@/lib/auth/checkout-gate'
import { getCheckoutPrefill } from '@/lib/orders/checkout-prefill'
import { isPurchaseBlocked } from '@/lib/orders/purchase-block'
import { lineSupport } from '@/lib/shop-config'
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

  // 只有會員能結帳。訪客先去註冊（註冊頁自己有「已有帳號 → 登入」的出口），
  // 註冊或登入完成後由 callbackUrl 帶回這裡；購物車在登入時會自動併入會員車。
  const session = await auth()
  if (!session?.user?.id) redirect(CHECKOUT_LOGIN_REDIRECT)

  const cart = await getCart()
  if (cart.items.length === 0) redirect('/cart')

  // 被停止購買服務的會員不給表單，直接說明原因與聯絡管道（createOrderFromCart 也會再擋一次）
  if (await isPurchaseBlocked(session.user.id)) {
    const t = await getTranslations('checkout')
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl tracking-[0.12em]">{t('title')}</h1>
        <div className="mt-8 border border-rose-accent/40 bg-rose-accent/5 px-5 py-4 text-sm leading-relaxed text-ink-700">
          <p className="font-medium text-ink-900">{t('purchaseBlockedTitle')}</p>
          <p className="mt-2">{t('purchaseBlockedBody')}</p>
          {lineSupport && (
            <a
              href={lineSupport.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block text-ink-900 underline underline-offset-4"
            >
              {t('purchaseBlockedLine')}
            </a>
          )}
        </div>
      </div>
    )
  }

  // 回購會員：收件人、門市、地址、付款與發票都從上一筆訂單與地址簿帶入
  const [t, paymentSettings, shipping, prefill] = await Promise.all([
    getTranslations('checkout'),
    getPaymentSettings(),
    getShippingSettings(),
    getCheckoutPrefill(session.user.id, session.user.email),
  ])

  const items = cart.items.map((item) => ({
    id: item.id,
    qty: item.qty,
    unitPrice: item.variant.price,
    productName: localizedName(locale, item.variant.product),
    variantName: item.variant.name,
    imageUrl: item.variant.product.images[0]?.url ?? null,
  }))

  // 有預購品項時先講清楚出貨時間：整張訂單會等全部到齊才一起出貨
  const preorderNames = cart.items
    .filter((item) => isPreorderLine(item.variant, item.variant.product.preorderEnabled, item.qty))
    .map((item) => `${localizedName(locale, item.variant.product)}（${item.variant.name}）`)

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="text-2xl tracking-[0.12em]">{t('title')}</h1>

      {preorderNames.length > 0 && (
        <div className="mt-6 border border-cream-300 bg-cream-50 px-4 py-3 text-sm leading-relaxed text-ink-700">
          <p className="font-medium text-ink-900">{t('preorderNoticeTitle')}</p>
          <p className="mt-1">{t('preorderNoticeBody', { items: preorderNames.join('、') })}</p>
        </div>
      )}

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
        prefill={prefill}
        shippingMethods={availableShippingMethods(shipping)}
        shippingFees={shippingFeesOf(shipping)}
        freeShippingThreshold={shipping.freeShippingThreshold}
        payment={{
          prepayEnabled: paymentSettings.prepayEnabled,
          methods: paymentSettings.methods,
          codEnabled: paymentSettings.codEnabled,
          codShippingMethods: paymentSettings.codShippingMethods,
          codFee: paymentSettings.codFee,
          codMaxAmount: paymentSettings.codMaxAmount,
          cvsExpireDays: paymentSettings.cvsExpireDays,
          atmExpireDays: paymentSettings.atmExpireDays,
          // 帳號不必傳進結帳頁 —— 下單後才在訂單頁與通知信上顯示
          bankTransferEnabled: isBankTransferAvailable(paymentSettings),
          bankExpireDays: paymentSettings.bankExpireDays,
        }}
      />
    </div>
  )
}
