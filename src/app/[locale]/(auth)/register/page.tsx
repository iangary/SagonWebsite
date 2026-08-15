import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { enabledSsoProviders } from '@/lib/env'
import { RegisterForm } from './register-form'

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
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('auth')

  return (
    <div className="mx-auto flex max-w-md flex-col px-6 py-16">
      <h1 className="text-center text-2xl tracking-[0.15em]">{t('registerTitle')}</h1>
      <RegisterForm ssoProviders={enabledSsoProviders} />
    </div>
  )
}
