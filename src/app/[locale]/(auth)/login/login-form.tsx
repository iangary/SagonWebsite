'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import * as Tabs from '@radix-ui/react-tabs'
import { Link } from '@/i18n/routing'
import { Button } from '@/components/ui/button'
import { Input, Field } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { SsoButtons } from '@/components/auth/sso-buttons'
import type { SsoProviderId } from '@/lib/auth/sso'
import { cn } from '@/lib/utils'

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
  const [error, setError] = React.useState<string | undefined>(initialError)

  return (
    <div className="mt-10 space-y-6">
      <SsoButtons providers={ssoProviders} callbackUrl={callbackUrl} />

      {error && (
        <p role="alert" className="border border-sale/30 bg-sale/5 px-3 py-2 text-sm text-sale">
          {error}
        </p>
      )}

      <Tabs.Root defaultValue="password" onValueChange={() => setError(undefined)}>
        <Tabs.List className="mb-6 flex border-b border-cream-200">
          <TabTrigger value="password">{t('loginWithPassword')}</TabTrigger>
          <TabTrigger value="phone">{t('loginWithPhone')}</TabTrigger>
        </Tabs.List>

        <Tabs.Content value="password">
          <PasswordForm callbackUrl={callbackUrl} onError={setError} />
        </Tabs.Content>
        <Tabs.Content value="phone">
          <PhoneForm callbackUrl={callbackUrl} onError={setError} />
        </Tabs.Content>
      </Tabs.Root>

      <p className="text-center text-sm text-taupe-500">
        {t('noAccount')}{' '}
        <Link href="/register" className="text-ink-900 underline underline-offset-4">
          {t('registerTitle')}
        </Link>
      </p>
    </div>
  )
}

function TabTrigger({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <Tabs.Trigger
      value={value}
      className="-mb-px border-b-2 border-transparent px-4 py-2.5 text-sm text-taupe-500 transition-colors data-[state=active]:border-ink-900 data-[state=active]:text-ink-900"
    >
      {children}
    </Tabs.Trigger>
  )
}

function PasswordForm({
  callbackUrl,
  onError,
}: {
  callbackUrl: string
  onError: (msg?: string) => void
}) {
  const t = useTranslations('auth')
  const router = useRouter()
  const [pending, setPending] = React.useState(false)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    onError(undefined)
    setPending(true)

    const data = new FormData(e.currentTarget)
    const res = await signIn('password', {
      email: String(data.get('email') ?? ''),
      password: String(data.get('password') ?? ''),
      redirect: false,
    })

    setPending(false)
    if (res?.error) {
      onError(t('invalidCredentials'))
      return
    }
    router.push(callbackUrl)
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label={t('email')} htmlFor="email" required>
        <Input id="email" name="email" type="email" autoComplete="email" required />
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
  )
}

const RESEND_SECONDS = 60

function PhoneForm({
  callbackUrl,
  onError,
}: {
  callbackUrl: string
  onError: (msg?: string) => void
}) {
  const t = useTranslations('auth')
  const router = useRouter()
  const { toast } = useToast()
  const [phone, setPhone] = React.useState('')
  const [sent, setSent] = React.useState(false)
  const [cooldown, setCooldown] = React.useState(0)
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  async function sendCode() {
    onError(undefined)
    setPending(true)
    try {
      const res = await fetch('/api/auth/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, purpose: 'login' }),
      })
      const data = (await res.json()) as {
        ok: boolean
        error?: string
        devCode?: string
        retryAfterSeconds?: number
      }

      if (!data.ok) {
        onError(data.error ?? t('sendFailed'))
        if (data.retryAfterSeconds) setCooldown(data.retryAfterSeconds)
        return
      }

      setSent(true)
      setCooldown(RESEND_SECONDS)
      // 開發環境把驗證碼直接顯示出來，省去翻 log
      toast(data.devCode ? t('otpSentDev', { code: data.devCode }) : t('otpSent'))
    } finally {
      setPending(false)
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    onError(undefined)
    setPending(true)

    const code = String(new FormData(e.currentTarget).get('code') ?? '')
    const res = await signIn('phone-otp', { phone, code, redirect: false })

    setPending(false)
    if (res?.error) {
      onError(t('invalidOtp'))
      return
    }
    router.push(callbackUrl)
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label={t('phone')} htmlFor="phone" required hint={t('phoneHint')}>
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="09xxxxxxxx"
          required
        />
      </Field>

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field label={t('otpCode')} htmlFor="code" required>
            <Input
              id="code"
              name="code"
              inputMode="numeric"
              maxLength={6}
              placeholder={t('otpPlaceholder')}
              disabled={!sent}
              required
            />
          </Field>
        </div>
        <Button
          type="button"
          variant="subtle"
          onClick={sendCode}
          disabled={pending || cooldown > 0 || phone.length < 10}
          className={cn('mb-0 shrink-0', cooldown > 0 && 'tabular-nums')}
        >
          {cooldown > 0 ? `${cooldown}s` : t('sendOtp')}
        </Button>
      </div>

      <Button type="submit" full disabled={pending || !sent}>
        {pending ? t('signingIn') : t('loginTitle')}
      </Button>
    </form>
  )
}
