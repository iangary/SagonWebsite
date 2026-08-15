import { getTranslations } from 'next-intl/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { enabledSsoProviders } from '@/lib/env'
import { SSO_PROVIDER_IDS } from '@/lib/auth/sso'
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

  const linked = new Set(user.accounts.map((a) => a.provider))

  /**
   * 已綁定但憑證後來被移掉的 provider 仍要列出來，否則使用者沒地方解除綁定。
   * 兩者皆非的（例如還沒申請的 LINE）就整列不顯示，免得對客人是雜訊。
   */
  const sso = SSO_PROVIDER_IDS.filter(
    (id) => enabledSsoProviders.includes(id) || linked.has(id),
  ).map((id) => ({ id, linked: linked.has(id), configured: enabledSsoProviders.includes(id) }))

  const hasPassword = Boolean(user.passwordHash)
  const hasPhone = Boolean(user.phone && user.phoneVerified)

  // 只剩一種登入方式時不能解除，否則會把自己鎖在門外
  const methodCount =
    sso.filter((p) => p.linked).length + (hasPassword ? 1 : 0) + (hasPhone ? 1 : 0)

  return (
    <SecurityPanel
      email={user.email}
      maskedPhone={user.phone ? maskMobile(user.phone) : null}
      sso={sso}
      hasPassword={hasPassword}
      hasPhone={hasPhone}
      isLastMethod={methodCount <= 1}
    />
  )
}
