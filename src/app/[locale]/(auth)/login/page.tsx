import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { isGoogleAuthEnabled } from '@/lib/env'
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

  return (
    <div className="mx-auto flex max-w-md flex-col px-6 py-16">
      <h1 className="text-center text-2xl tracking-[0.15em]">{t('loginTitle')}</h1>

      <LoginForm
        callbackUrl={callbackUrl ?? '/account'}
        googleEnabled={isGoogleAuthEnabled}
        initialError={error ? t('invalidCredentials') : undefined}
        labels={{
          continueWithGoogle: t('continueWithGoogle'),
          orDivider: t('orDivider'),
          email: t('email'),
          password: t('password'),
          phone: t('phone'),
          otpCode: t('otpCode'),
          sendOtp: t('sendOtp'),
          loginWithPassword: t('loginWithPassword'),
          loginWithPhone: t('loginWithPhone'),
          submit: t('loginTitle'),
          noAccount: t('noAccount'),
          register: t('registerTitle'),
          otpSent: t('otpSent'),
        }}
      />
    </div>
  )
}
