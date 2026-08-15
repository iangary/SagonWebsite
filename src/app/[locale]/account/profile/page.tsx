import { getLocale, getTranslations } from 'next-intl/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { maskMobile } from '@/lib/sms/provider'
import { ProfileForm } from './profile-form'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'account' })
  return { title: t('profile'), robots: { index: false } }
}

export default async function ProfilePage() {
  const [t, locale, sessionUser] = await Promise.all([
    getTranslations('account'),
    getLocale(),
    requireUser(),
  ])

  const user = await db.user.findUniqueOrThrow({
    where: { id: sessionUser.id },
    select: {
      name: true,
      email: true,
      phone: true,
      phoneVerified: true,
      createdAt: true,
      _count: { select: { orders: true } },
    },
  })

  return (
    <div className="space-y-6">
      <ProfileForm defaultName={user.name ?? ''} />

      <section className="border border-cream-200 bg-white p-6">
        <h2 className="text-sm tracking-[0.1em]">{t('accountInfo')}</h2>
        <dl className="mt-4 space-y-2.5 text-sm">
          <Row label={t('emailLabel')} value={user.email ?? t('emailNotSetShort')} />
          <Row
            label={t('phoneLabel')}
            value={
              user.phone
                ? `${maskMobile(user.phone)}${
                    user.phoneVerified
                      ? t('phoneVerifiedSuffix')
                      : t('phoneUnverifiedSuffix')
                  }`
                : t('phoneNotLinked')
            }
          />
          <Row label={t('registeredAt')} value={user.createdAt.toLocaleDateString(locale)} />
          <Row label={t('orderCount')} value={String(user._count.orders)} />
        </dl>
        <p className="mt-4 text-xs text-taupe-500">{t('profileSecurityHint')}</p>
      </section>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-taupe-600">{label}</dt>
      <dd className="text-right text-ink-900">{value}</dd>
    </div>
  )
}
