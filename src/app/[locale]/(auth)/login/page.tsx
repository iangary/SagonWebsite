import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { enabledSsoProviders } from '@/lib/env'
import { isCheckoutCallback } from '@/lib/auth/checkout-gate'
import { CheckoutGateNotice } from '@/components/auth/checkout-gate-notice'
import { LoginForm } from './login-form'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'auth' })
  return { title: t('loginTitle') }
}

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ callbackUrl?: string; error?: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const { callbackUrl, error } = await searchParams
  const t = await getTranslations('auth')

  // 只收站內相對路徑，免得被塞成 open redirect
  const target = callbackUrl?.startsWith('/') ? callbackUrl : undefined

  return (
    <div className="mx-auto flex max-w-md flex-col px-6 py-16">
      <h1 className="text-center text-2xl tracking-[0.15em]">{t('loginTitle')}</h1>

      {isCheckoutCallback(target) && (
        <CheckoutGateNotice>{t('checkoutNeedsAccount')}</CheckoutGateNotice>
      )}

      <LoginForm
        callbackUrl={target ?? '/account'}
        ssoProviders={enabledSsoProviders}
        initialError={error ? t('invalidCredentials') : undefined}
      />
    </div>
  )
}
