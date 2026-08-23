import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/routing'

export const dynamic = 'force-dynamic'

/** route handler 導過來時帶的狀態；其他值一律當成連結無效。 */
const STATUSES = ['ok', 'already', 'expired', 'invalid'] as const
type Status = (typeof STATUSES)[number]

function toStatus(raw: string | undefined): Status {
  return STATUSES.includes(raw as Status) ? (raw as Status) : 'invalid'
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'auth' })
  return { title: t('verifyEmailTitle'), robots: { index: false } }
}

export default async function VerifyEmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ status?: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const { status: rawStatus } = await searchParams
  const status = toStatus(rawStatus)
  const t = await getTranslations('auth')

  const verified = status === 'ok' || status === 'already'

  return (
    <div className="mx-auto flex max-w-md flex-col px-6 py-16 text-center">
      <h1 className="text-2xl tracking-[0.15em]">{t('verifyEmailTitle')}</h1>

      <p className="mt-6 text-sm leading-relaxed text-taupe-600">
        {t(
          status === 'ok'
            ? 'verifyEmailOk'
            : status === 'already'
              ? 'verifyEmailAlready'
              : status === 'expired'
                ? 'verifyEmailExpired'
                : 'verifyEmailInvalid',
        )}
      </p>

      <Link
        href={verified ? '/account/orders' : '/account/security'}
        className="mt-8 self-center border border-ink-900 px-6 py-3 text-sm tracking-[0.08em] text-ink-900"
      >
        {verified ? t('verifyEmailGoAccount') : t('verifyEmailResend')}
      </Link>
    </div>
  )
}
