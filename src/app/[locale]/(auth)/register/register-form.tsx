'use client'

import * as React from 'react'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { getCsrfToken, signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Link } from '@/i18n/routing'
import { Button } from '@/components/ui/button'
import { Input, Field } from '@/components/ui/input'
import { SsoButtons } from '@/components/auth/sso-buttons'
import type { SsoProviderId } from '@/lib/auth/sso'
import { registerAction, type RegisterState } from './actions'

const INITIAL: RegisterState = { ok: false }

export function RegisterForm({
  ssoProviders,
  callbackUrl = '/account',
}: {
  ssoProviders: SsoProviderId[]
  /** 註冊完成（並自動登入）後要去的地方。從結帳被擋下來的人要回結帳頁。 */
  callbackUrl?: string
}) {
  const t = useTranslations('auth')
  const router = useRouter()
  const [state, formAction, pending] = useActionState(registerAction, INITIAL)

  /**
   * 送出當下先把帳密留一份。
   *
   * React 會在 form action 跑完後**清空未受控欄位**，所以下面的 effect 已經讀不到
   * 使用者剛才輸入的值了 —— 從表單重讀會拿到空字串，自動登入靜默失敗，
   * 人被丟到登入頁重打一次密碼。
   */
  const submitted = React.useRef<{ identifier: string; password: string } | null>(null)

  // 註冊成功後直接用剛填的帳密登入，不要再叫使用者輸入一次
  React.useEffect(() => {
    if (!state.ok) return
    const credentials = submitted.current
    if (!credentials) return

    // getCsrfToken() 先跑：signIn() 的 POST 若與別的 /api/auth/csrf 並行，
    // cookie 會被後到的換掉而對不上，Auth.js 回 MissingCSRF（見 login-form 的說明）。
    void getCsrfToken()
      .then(() => signIn('password', { ...credentials, redirect: false }))
      .then(() => {
        router.push(callbackUrl)
        router.refresh()
      })
  }, [state.ok, router, callbackUrl])

  const errors = state.fieldErrors ?? {}

  return (
    <div className="mt-10 space-y-6">
      <SsoButtons providers={ssoProviders} callbackUrl={callbackUrl} />

      {state.error && (
        <p role="alert" className="border border-sale/30 bg-sale/5 px-3 py-2 text-sm text-sale">
          {state.error}
        </p>
      )}

      <form
        action={(formData) => {
          submitted.current = {
            identifier: String(formData.get('email') ?? ''),
            password: String(formData.get('password') ?? ''),
          }
          formAction(formData)
        }}
        className="space-y-4"
      >
        <Field label={t('name')} htmlFor="name" required error={errors.name}>
          <Input id="name" name="name" autoComplete="name" required />
        </Field>

        <Field label={t('email')} htmlFor="email" required error={errors.email}>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>

        <Field
          label={t('phone')}
          htmlFor="phone"
          error={errors.phone}
          hint={t('phoneOptionalHint')}
        >
          <Input id="phone" name="phone" type="tel" inputMode="numeric" autoComplete="tel" />
        </Field>

        <Field
          label={t('password')}
          htmlFor="password"
          required
          error={errors.password}
          hint={t('passwordHint')}
        >
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </Field>

        <Field
          label={t('confirmPassword')}
          htmlFor="confirmPassword"
          required
          error={errors.confirmPassword}
        >
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
          />
        </Field>

        <Button type="submit" full disabled={pending || state.ok}>
          {pending ? t('processing') : state.ok ? t('signingIn') : t('registerTitle')}
        </Button>
      </form>

      <p className="text-center text-sm text-taupe-500">
        {t('hasAccount')}{' '}
        <Link
          href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}
          className="text-ink-900 underline underline-offset-4"
        >
          {t('loginTitle')}
        </Link>
      </p>
    </div>
  )
}
