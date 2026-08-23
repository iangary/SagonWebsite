import { getTranslations } from 'next-intl/server'
import { db } from '@/lib/db'
import { currentUser } from '@/lib/auth'
import { AccountNav } from './account-nav'
import { EmailVerificationNotice } from './email-verification-notice'

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('account')

  /**
   * 未驗證的提示放在 layout 而不是某一頁 —— 註冊完會落在 /account/orders，
   * 只掛在「帳號安全」頁的話新註冊的人根本看不到。
   * 用 currentUser()（可為 null）而不是 requireUser()：擋登入是 src/proxy.ts 的事，
   * layout 拋錯會變成錯誤頁而不是導去登入。
   */
  const sessionUser = await currentUser()
  const user = sessionUser
    ? await db.user.findUnique({
        where: { id: sessionUser.id },
        select: { email: true, emailVerified: true },
      })
    : null
  const unverifiedEmail = user?.email && !user.emailVerified ? user.email : null

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="text-2xl tracking-[0.12em]">{t('title')}</h1>

      <div className="mt-10 gap-10 lg:flex lg:items-start">
        <AccountNav
          labels={{
            orders: t('orders'),
            addresses: t('addresses'),
            profile: t('profile'),
            security: t('security'),
          }}
        />
        <div className="mt-8 min-w-0 flex-1 lg:mt-0">
          {unverifiedEmail && (
            <EmailVerificationNotice
              labels={{
                title: t('emailUnverified'),
                hint: t('emailUnverifiedHint', { email: unverifiedEmail }),
                resend: t('resendVerification'),
                sending: t('sendingVerification'),
              }}
            />
          )}
          {children}
        </div>
      </div>
    </div>
  )
}
