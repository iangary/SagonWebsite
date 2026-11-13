import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { enabledSsoProviders } from '@/lib/env'
import { isCheckoutCallback } from '@/lib/auth/checkout-gate'
import { CheckoutGateNotice } from '@/components/auth/checkout-gate-notice'
import { RegisterForm } from './register-form'
import { safeCallbackUrl } from '@/lib/auth/callback-url'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'auth' })
  return { title: t('registerTitle') }
}

export default async function RegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ callbackUrl?: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const { callbackUrl } = await searchParams
  const t = await getTranslations('auth')

  // 只收站內相對路徑，免得被塞成 open redirect
  const target = safeCallbackUrl(callbackUrl)

  return (
    <div className="mx-auto flex max-w-md flex-col px-6 py-16">
      <h1 className="text-center text-2xl tracking-[0.15em]">{t('registerTitle')}</h1>

      {isCheckoutCallback(target) && (
        <CheckoutGateNotice>{t('checkoutNeedsAccount')}</CheckoutGateNotice>
      )}

      <RegisterForm ssoProviders={enabledSsoProviders} callbackUrl={target ?? '/account'} />
    </div>
  )
}
