import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { ForgotPasswordForm } from './forgot-password-form'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'auth' })
  return { title: t('forgotPasswordTitle'), robots: { index: false } }
}

export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations('auth')

  return (
    <div className="mx-auto flex max-w-md flex-col px-6 py-16">
      <h1 className="text-center text-2xl tracking-[0.15em]">{t('forgotPasswordTitle')}</h1>
      <p className="mt-4 text-center text-sm leading-relaxed text-taupe-600">
        {t('forgotPasswordIntro')}
      </p>
      <ForgotPasswordForm />
    </div>
  )
}
