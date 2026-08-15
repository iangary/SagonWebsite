'use client'

import * as React from 'react'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Link } from '@/i18n/routing'
import { Button } from '@/components/ui/button'
import { Input, Field } from '@/components/ui/input'
import { SsoButtons } from '@/components/auth/sso-buttons'
import type { SsoProviderId } from '@/lib/auth/sso'
import { registerAction, type RegisterState } from './actions'

const INITIAL: RegisterState = { ok: false }

export function RegisterForm({ ssoProviders }: { ssoProviders: SsoProviderId[] }) {
  const t = useTranslations('auth')
  const router = useRouter()
  const [state, formAction, pending] = useActionState(registerAction, INITIAL)
  const formRef = React.useRef<HTMLFormElement>(null)

  // 註冊成功後直接用剛填的帳密登入，不要再叫使用者輸入一次
  React.useEffect(() => {
    if (!state.ok) return
    const form = formRef.current
    if (!form) return

    const data = new FormData(form)
    void signIn('password', {
      email: String(data.get('email') ?? ''),
      password: String(data.get('password') ?? ''),
      redirect: false,
    }).then(() => {
      router.push('/account')
      router.refresh()
    })
  }, [state.ok, router])

  const errors = state.fieldErrors ?? {}

  return (
    <div className="mt-10 space-y-6">
      <SsoButtons providers={ssoProviders} callbackUrl="/account" />

      {state.error && (
        <p role="alert" className="border border-sale/30 bg-sale/5 px-3 py-2 text-sm text-sale">
          {state.error}
        </p>
      )}

      <form ref={formRef} action={formAction} className="space-y-4">
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
        <Link href="/login" className="text-ink-900 underline underline-offset-4">
          {t('loginTitle')}
        </Link>
      </p>
    </div>
  )
}
