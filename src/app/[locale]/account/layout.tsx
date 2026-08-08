import { getTranslations } from 'next-intl/server'
import { AccountNav } from './account-nav'

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('account')

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
        <div className="mt-8 min-w-0 flex-1 lg:mt-0">{children}</div>
      </div>
    </div>
  )
}
