import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/auth'
import { maskMobile } from '@/lib/sms/provider'
import { SetPasswordForm } from './set-password-form'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'auth' })
  return { title: t('setPasswordTitle'), robots: { index: false } }
}

/**
 * 手機驗證碼第一次登入後的必經頁。
 *
 * 未登入的人由 src/proxy.ts 的 PROTECTED 導去登入頁；
 * 還沒設密碼的人被同一支 proxy 擋在這裡（全站硬擋），設完才放行。
 */
export default async function SetPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const user = await requireUser()

  /**
   * 已經有密碼的人也可能被導來這裡（token 還是舊的，例如在另一台裝置設過密碼）。
   * 這裡**不能** redirect 出去 —— proxy 會拿同一個舊 token 再把他導回來，變成無限轉址。
   * 改成給他一顆「繼續」，由 action 把旗標關掉才是真的解鎖。
   */
  const { passwordHash } = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { passwordHash: true },
  })

  const t = await getTranslations('auth')

  return (
    <div className="mx-auto flex max-w-md flex-col px-6 py-16">
      <h1 className="text-center text-2xl tracking-[0.15em]">{t('setPasswordTitle')}</h1>
      <p className="mt-4 text-center text-sm leading-relaxed text-taupe-600">
        {passwordHash ? t('setPasswordAlready') : t('setPasswordIntro')}
      </p>

      <SetPasswordForm
        maskedPhone={user.phone ? maskMobile(user.phone) : null}
        alreadyHasPassword={Boolean(passwordHash)}
      />
    </div>
  )
}
