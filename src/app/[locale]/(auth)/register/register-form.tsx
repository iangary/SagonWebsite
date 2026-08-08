'use client'

import * as React from 'react'
import { useActionState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Link } from '@/i18n/routing'
import { Button } from '@/components/ui/button'
import { Input, Field } from '@/components/ui/input'
import { registerAction, type RegisterState } from './actions'

type Labels = {
  continueWithGoogle: string
  orDivider: string
  name: string
  email: string
  phone: string
  password: string
  confirmPassword: string
  submit: string
  hasAccount: string
  login: string
}

const INITIAL: RegisterState = { ok: false }

export function RegisterForm({
  googleEnabled,
  labels,
}: {
  googleEnabled: boolean
  labels: Labels
}) {
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
      {googleEnabled && (
        <>
          <Button variant="outline" full onClick={() => signIn('google', { redirectTo: '/account' })}>
            {labels.continueWithGoogle}
          </Button>
          <div className="flex items-center gap-3 text-xs text-taupe-400">
            <span className="h-px flex-1 bg-cream-200" />
            {labels.orDivider}
            <span className="h-px flex-1 bg-cream-200" />
          </div>
        </>
      )}

      {state.error && (
        <p role="alert" className="border border-sale/30 bg-sale/5 px-3 py-2 text-sm text-sale">
          {state.error}
        </p>
      )}

      <form ref={formRef} action={formAction} className="space-y-4">
        <Field label={labels.name} htmlFor="name" required error={errors.name}>
          <Input id="name" name="name" autoComplete="name" required />
        </Field>

        <Field label={labels.email} htmlFor="email" required error={errors.email}>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>

        <Field
          label={labels.phone}
          htmlFor="phone"
          error={errors.phone}
          hint="選填。填了之後也可以用手機驗證碼登入。"
        >
          <Input id="phone" name="phone" type="tel" inputMode="numeric" autoComplete="tel" />
        </Field>

        <Field
          label={labels.password}
          htmlFor="password"
          required
          error={errors.password}
          hint="至少 8 個字元"
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
          label={labels.confirmPassword}
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
          {pending ? '處理中…' : state.ok ? '登入中…' : labels.submit}
        </Button>
      </form>

      <p className="text-center text-sm text-taupe-500">
        {labels.hasAccount}{' '}
        <Link href="/login" className="text-ink-900 underline underline-offset-4">
          {labels.login}
        </Link>
      </p>
    </div>
  )
}
