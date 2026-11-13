import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { SmsLoginForm } from './sms-login-form'
import { safeCallbackUrl } from '@/lib/auth/callback-url'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'auth' })
  return { title: t('smsLoginTitle'), robots: { index: false } }
}

export default async function SmsLoginPage({
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

  // 只收站內相對路徑，免得被塞成 open redirect（與 /login 同一套規則）
  const target = safeCallbackUrl(callbackUrl)

  return (
    <div className="mx-auto flex max-w-md flex-col px-6 py-16">
      <h1 className="text-center text-2xl tracking-[0.15em]">{t('smsLoginTitle')}</h1>
      <p className="mt-4 text-center text-sm leading-relaxed text-taupe-600">
        {t('smsLoginIntro')}
      </p>

      <SmsLoginForm callbackUrl={target ?? '/account'} />
    </div>
  )
}
