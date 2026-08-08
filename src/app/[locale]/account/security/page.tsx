import { getTranslations } from 'next-intl/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { isGoogleAuthEnabled } from '@/lib/env'
import { maskMobile } from '@/lib/sms/provider'
import { SecurityPanel } from './security-panel'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'account' })
  return { title: t('security'), robots: { index: false } }
}

export default async function SecurityPage() {
  const sessionUser = await requireUser()

  const user = await db.user.findUniqueOrThrow({
    where: { id: sessionUser.id },
    select: {
      email: true,
      phone: true,
      phoneVerified: true,
      passwordHash: true,
      accounts: { select: { provider: true } },
    },
  })

  const hasGoogle = user.accounts.some((a) => a.provider === 'google')
  const hasPassword = Boolean(user.passwordHash)
  const hasPhone = Boolean(user.phone && user.phoneVerified)

  // 只剩一種登入方式時不能解除，否則會把自己鎖在門外
  const methodCount = [hasGoogle, hasPassword, hasPhone].filter(Boolean).length

  return (
    <SecurityPanel
      email={user.email}
      maskedPhone={user.phone ? maskMobile(user.phone) : null}
      hasGoogle={hasGoogle}
      hasPassword={hasPassword}
      hasPhone={hasPhone}
      googleEnabled={isGoogleAuthEnabled}
      isLastMethod={methodCount <= 1}
    />
  )
}
