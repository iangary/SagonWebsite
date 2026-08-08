import { getTranslations } from 'next-intl/server'
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
  const sessionUser = await requireUser()

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
        <h2 className="text-sm tracking-[0.1em]">帳號資訊</h2>
        <dl className="mt-4 space-y-2.5 text-sm">
          <Row label="電子信箱" value={user.email ?? '尚未設定'} />
          <Row
            label="手機號碼"
            value={
              user.phone
                ? `${maskMobile(user.phone)}${user.phoneVerified ? '（已驗證）' : '（未驗證）'}`
                : '尚未綁定'
            }
          />
          <Row label="註冊日期" value={user.createdAt.toLocaleDateString('zh-TW')} />
          <Row label="訂單筆數" value={String(user._count.orders)} />
        </dl>
        <p className="mt-4 text-xs text-taupe-500">
          Email 與手機的變更請至「帳號安全」頁面操作。
        </p>
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
