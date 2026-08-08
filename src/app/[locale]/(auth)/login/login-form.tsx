'use client'

import * as React from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import * as Tabs from '@radix-ui/react-tabs'
import { Link } from '@/i18n/routing'
import { Button } from '@/components/ui/button'
import { Input, Field } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

type Labels = {
  continueWithGoogle: string
  orDivider: string
  email: string
  password: string
  phone: string
  otpCode: string
  sendOtp: string
  loginWithPassword: string
  loginWithPhone: string
  submit: string
  noAccount: string
  register: string
  otpSent: string
}

export function LoginForm({
  callbackUrl,
  googleEnabled,
  initialError,
  labels,
}: {
  callbackUrl: string
  googleEnabled: boolean
  initialError?: string
  labels: Labels
}) {
  const [error, setError] = React.useState<string | undefined>(initialError)

  return (
    <div className="mt-10 space-y-6">
      {googleEnabled && (
        <>
          <Button
            variant="outline"
            full
            onClick={() => signIn('google', { redirectTo: callbackUrl })}
          >
            <GoogleMark />
            {labels.continueWithGoogle}
          </Button>

          <div className="flex items-center gap-3 text-xs text-taupe-400">
            <span className="h-px flex-1 bg-cream-200" />
            {labels.orDivider}
            <span className="h-px flex-1 bg-cream-200" />
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="border border-sale/30 bg-sale/5 px-3 py-2 text-sm text-sale">
          {error}
        </p>
      )}

      <Tabs.Root defaultValue="password" onValueChange={() => setError(undefined)}>
        <Tabs.List className="mb-6 flex border-b border-cream-200">
          <TabTrigger value="password">{labels.loginWithPassword}</TabTrigger>
          <TabTrigger value="phone">{labels.loginWithPhone}</TabTrigger>
        </Tabs.List>

        <Tabs.Content value="password">
          <PasswordForm callbackUrl={callbackUrl} labels={labels} onError={setError} />
        </Tabs.Content>
        <Tabs.Content value="phone">
          <PhoneForm callbackUrl={callbackUrl} labels={labels} onError={setError} />
        </Tabs.Content>
      </Tabs.Root>

      <p className="text-center text-sm text-taupe-500">
        {labels.noAccount}{' '}
        <Link href="/register" className="text-ink-900 underline underline-offset-4">
          {labels.register}
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
  labels,
  onError,
}: {
  callbackUrl: string
  labels: Labels
  onError: (msg?: string) => void
}) {
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
      onError('帳號或密碼錯誤')
      return
    }
    router.push(callbackUrl)
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label={labels.email} htmlFor="email" required>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label={labels.password} htmlFor="password" required>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <Button type="submit" full disabled={pending}>
        {pending ? '登入中…' : labels.submit}
      </Button>
    </form>
  )
}

const RESEND_SECONDS = 60

function PhoneForm({
  callbackUrl,
  labels,
  onError,
}: {
  callbackUrl: string
  labels: Labels
  onError: (msg?: string) => void
}) {
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
        onError(data.error ?? '發送失敗')
        if (data.retryAfterSeconds) setCooldown(data.retryAfterSeconds)
        return
      }

      setSent(true)
      setCooldown(RESEND_SECONDS)
      // 開發環境把驗證碼直接顯示出來，省去翻 log
      toast(data.devCode ? `${labels.otpSent}（開發模式驗證碼：${data.devCode}）` : labels.otpSent)
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
      onError('驗證碼錯誤或已過期')
      return
    }
    router.push(callbackUrl)
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label={labels.phone} htmlFor="phone" required hint="例：0912345678">
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
          <Field label={labels.otpCode} htmlFor="code" required>
            <Input
              id="code"
              name="code"
              inputMode="numeric"
              maxLength={6}
              placeholder="6 位數字"
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
          {cooldown > 0 ? `${cooldown}s` : labels.sendOtp}
        </Button>
      </div>

      <Button type="submit" full disabled={pending || !sent}>
        {pending ? '登入中…' : labels.submit}
      </Button>
    </form>
  )
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.46 14.97.5 12 .5A11 11 0 0 0 2.18 7.05l3.66 2.84c.87-2.6 3.3-4.14 6.16-4.14Z"
      />
    </svg>
  )
}
