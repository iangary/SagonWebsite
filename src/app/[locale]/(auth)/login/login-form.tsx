'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { getCsrfToken, signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Link } from '@/i18n/routing'
import { Button } from '@/components/ui/button'
import { Input, Field } from '@/components/ui/input'
import { SsoButtons } from '@/components/auth/sso-buttons'
import type { SsoProviderId } from '@/lib/auth/sso'

/**
 * 登入只有一張表單：帳號（手機號碼或 Email）＋密碼。
 *
 * 驗證碼不是常態登入方式 —— 它只在「第一次用手機登入」與「忘記密碼」兩處出現，
 * 所以那兩條路收在表單下方的連結，而不是跟密碼並列的分頁（並列會讓人以為
 * 每次登入都要等簡訊，簡訊每則都要錢）。
 */
export function LoginForm({
  callbackUrl,
  ssoProviders,
  initialError,
}: {
  callbackUrl: string
  ssoProviders: SsoProviderId[]
  initialError?: string
}) {
  const t = useTranslations('auth')
  const router = useRouter()
  const [error, setError] = React.useState<string | undefined>(initialError)
  const [pending, setPending] = React.useState(false)

  /**
   * 送出前先確保 csrf cookie 已經落地。
   *
   * Auth.js 是拿「cookie 裡的 token」與「POST 帶的 token」對比，而 signIn() 自己
   * 也會去要一次 token —— 若頁面上有兩個 /api/auth/csrf 同時在飛，後到的會把 cookie
   * 換掉，送出的那個就對不上，Auth.js 回 MissingCSRF、前端只看到「帳號或密碼錯誤」，
   * 重按一次才成功。這裡**依序**先要一次，之後 signIn() 拿到的就是同一組。
   */
  async function ensureCsrfCookie() {
    await getCsrfToken()
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(undefined)
    setPending(true)

    // FormData 一定要在 await 之前讀：React 的事件物件過了 await 就沒有 currentTarget，
    // 之後再 new FormData(event.currentTarget) 會直接拋錯，連 POST 都送不出去。
    const data = new FormData(event.currentTarget)
    await ensureCsrfCookie()

    const res = await signIn('password', {
      // 手機註冊的會員沒有 Email，帳號欄位收號碼或 Email 兩種
      identifier: String(data.get('identifier') ?? ''),
      password: String(data.get('password') ?? ''),
      redirect: false,
    })

    setPending(false)
    if (res?.error) {
      setError(t('invalidCredentials'))
      return
    }
    router.push(callbackUrl)
    router.refresh()
  }

  const withCallback = (path: string) =>
    `${path}?callbackUrl=${encodeURIComponent(callbackUrl)}` as const

  return (
    <div className="mt-10 space-y-6">
      <SsoButtons providers={ssoProviders} callbackUrl={callbackUrl} />

      {error && (
        <p role="alert" className="border border-sale/30 bg-sale/5 px-3 py-2 text-sm text-sale">
          {error}
        </p>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <Field label={t('identifier')} htmlFor="identifier" required hint={t('identifierHint')}>
          <Input id="identifier" name="identifier" autoComplete="username" required />
        </Field>
        <Field label={t('password')} htmlFor="password" required>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>
        <Button type="submit" full disabled={pending}>
          {pending ? t('signingIn') : t('loginTitle')}
        </Button>
      </form>

      <p className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-center text-sm text-taupe-500">
        <Link
          href={withCallback('/login/sms')}
          className="text-ink-900 underline underline-offset-4"
        >
          {t('firstTimePhoneLogin')}
        </Link>
        <Link href="/forgot-password" className="underline underline-offset-4">
          {t('forgotPassword')}
        </Link>
      </p>

      <p className="text-center text-sm text-taupe-500">
        {t('noAccount')}{' '}
        <Link href={withCallback('/register')} className="text-ink-900 underline underline-offset-4">
          {t('registerTitle')}
        </Link>
      </p>
    </div>
  )
}
