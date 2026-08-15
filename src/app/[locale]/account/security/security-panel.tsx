'use client'

import * as React from 'react'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { Check, KeyRound, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Field } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { SsoMark } from '@/components/auth/sso-buttons'
import { SSO_PROVIDER_LABELS, type SsoProviderId } from '@/lib/auth/sso'
import { setPassword, bindPhone, unlinkProvider, type ActionState } from '../actions'

const INITIAL: ActionState = { ok: false }

export type SsoStatus = {
  id: SsoProviderId
  /** 這個帳號已經綁了這個 provider */
  linked: boolean
  /** 站台有設定這個 provider 的憑證（沒設定就不能新綁，但已綁的仍可解除） */
  configured: boolean
}

export function SecurityPanel({
  email,
  maskedPhone,
  sso,
  hasPassword,
  hasPhone,
  isLastMethod,
}: {
  email: string | null
  maskedPhone: string | null
  sso: SsoStatus[]
  hasPassword: boolean
  hasPhone: boolean
  isLastMethod: boolean
}) {
  const t = useTranslations('account')

  return (
    <div className="space-y-5">
      <section className="border border-cream-200 bg-white p-6">
        <h2 className="text-sm tracking-[0.1em]">{t('loginMethods')}</h2>
        <p className="mt-2 text-xs text-taupe-500">{t('loginMethodsHint')}</p>

        <ul className="mt-5 divide-y divide-cream-100">
          {sso.map((provider) => (
            <MethodRow
              key={provider.id}
              icon={<SsoMark id={provider.id} />}
              title={t('ssoAccount', { provider: SSO_PROVIDER_LABELS[provider.id] })}
              status={provider.linked ? t('linked') : t('notLinked')}
              active={provider.linked}
              activeLabel={t('active')}
              action={<SsoBinding provider={provider} isLastMethod={isLastMethod} />}
            />
          ))}
          <MethodRow
            icon={<KeyRound size={16} strokeWidth={1.5} />}
            title={t('emailPassword')}
            status={
              hasPassword
                ? t('passwordSet', { email: email ?? '—' })
                : email
                  ? t('passwordNotSet')
                  : t('emailNotSet')
            }
            active={hasPassword}
            activeLabel={t('active')}
          />
          <MethodRow
            icon={<Smartphone size={16} strokeWidth={1.5} />}
            title={t('phoneOtp')}
            status={hasPhone ? t('phoneLinked', { phone: maskedPhone ?? '—' }) : t('notLinked')}
            active={hasPhone}
            activeLabel={t('active')}
          />
        </ul>
      </section>

      <PasswordSection hasPassword={hasPassword} />
      <PhoneSection hasPhone={hasPhone} maskedPhone={maskedPhone} />
    </div>
  )
}

function MethodRow({
  icon,
  title,
  status,
  active,
  activeLabel,
  action,
}: {
  icon: React.ReactNode
  title: string
  status: string
  active: boolean
  activeLabel: string
  action?: React.ReactNode
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3.5">
      <div className="flex items-center gap-3">
        <span className={active ? 'text-taupe-600' : 'text-taupe-400'}>{icon}</span>
        <div>
          <p className="text-sm text-ink-900">{title}</p>
          <p className="mt-0.5 text-xs text-taupe-500">{status}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {active && (
          <Badge tone="success">
            <Check size={11} className="mr-1" />
            {activeLabel}
          </Badge>
        )}
        {action}
      </div>
    </li>
  )
}

function SsoBinding({
  provider,
  isLastMethod,
}: {
  provider: SsoStatus
  isLastMethod: boolean
}) {
  const t = useTranslations('account')
  const router = useRouter()
  const { toast } = useToast()
  const [pending, setPending] = React.useState(false)

  const label = SSO_PROVIDER_LABELS[provider.id]

  async function unlink() {
    if (!window.confirm(t('confirmUnlinkSso', { provider: label }))) return
    setPending(true)
    const result = await unlinkProvider(provider.id)
    setPending(false)

    if (!result.ok) {
      toast(result.error ?? t('unlinkFailed'), 'error')
      return
    }
    toast(t('ssoUnlinked', { provider: label }))
    router.refresh()
  }

  if (!provider.linked) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => signIn(provider.id, { redirectTo: '/account/security' })}
      >
        {t('link')}
      </Button>
    )
  }

  return (
    <Button size="sm" variant="ghost" disabled={pending || isLastMethod} onClick={unlink}>
      {isLastMethod ? t('onlyLoginMethod') : t('unbind')}
    </Button>
  )
}

function PasswordSection({ hasPassword }: { hasPassword: boolean }) {
  const t = useTranslations('account')
  const tCheckout = useTranslations('checkout')
  const { toast } = useToast()
  const router = useRouter()
  const [state, formAction, pending] = useActionState(setPassword, INITIAL)
  const formRef = React.useRef<HTMLFormElement>(null)

  React.useEffect(() => {
    if (state.ok && state.message) {
      toast(state.message)
      formRef.current?.reset()
      router.refresh()
    }
    if (state.error) toast(state.error, 'error')
  }, [state, toast, router])

  const errors = state.fieldErrors ?? {}

  return (
    <form ref={formRef} action={formAction} className="border border-cream-200 bg-white p-6">
      <h2 className="text-sm tracking-[0.1em]">
        {hasPassword ? t('changePassword') : t('setPassword')}
      </h2>
      <p className="mt-2 text-xs text-taupe-500">
        {hasPassword ? t('changePasswordHint') : t('setPasswordHint')}
      </p>

      <div className="mt-5 grid max-w-sm gap-4">
        {hasPassword && (
          <Field
            label={t('currentPassword')}
            htmlFor="currentPassword"
            required
            error={errors.currentPassword}
          >
            <Input
              id="currentPassword"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>
        )}
        <Field
          label={t('newPassword')}
          htmlFor="newPassword"
          required
          error={errors.newPassword}
          hint={t('newPasswordHint')}
        >
          <Input
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </Field>
        <Field
          label={t('confirmNewPassword')}
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
      </div>

      <Button type="submit" className="mt-6" disabled={pending}>
        {pending ? tCheckout('processingShort') : hasPassword ? t('changePassword') : t('setPassword')}
      </Button>
    </form>
  )
}

const RESEND_SECONDS = 60

function PhoneSection({
  hasPhone,
  maskedPhone,
}: {
  hasPhone: boolean
  maskedPhone: string | null
}) {
  const t = useTranslations('account')
  const { toast } = useToast()
  const router = useRouter()
  const [state, formAction, pending] = useActionState(bindPhone, INITIAL)
  const [phone, setPhone] = React.useState('')
  const [sent, setSent] = React.useState(false)
  const [cooldown, setCooldown] = React.useState(0)
  const [sending, setSending] = React.useState(false)

  React.useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  React.useEffect(() => {
    if (state.ok && state.message) {
      toast(state.message)
      setSent(false)
      setPhone('')
      router.refresh()
    }
    if (state.error) toast(state.error, 'error')
  }, [state, toast, router])

  async function sendCode() {
    setSending(true)
    try {
      const res = await fetch('/api/auth/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, purpose: 'bind' }),
      })
      const data = (await res.json()) as {
        ok: boolean
        error?: string
        devCode?: string
        retryAfterSeconds?: number
      }

      if (!data.ok) {
        toast(data.error ?? t('sendFailed'), 'error')
        if (data.retryAfterSeconds) setCooldown(data.retryAfterSeconds)
        return
      }

      setSent(true)
      setCooldown(RESEND_SECONDS)
      toast(data.devCode ? t('otpSentDev', { code: data.devCode }) : t('otpSent'))
    } finally {
      setSending(false)
    }
  }

  return (
    <form action={formAction} className="border border-cream-200 bg-white p-6">
      <h2 className="text-sm tracking-[0.1em]">
        {hasPhone ? t('changePhone') : t('bindPhone')}
      </h2>
      <p className="mt-2 text-xs text-taupe-500">
        {hasPhone
          ? t('changePhoneHint', { phone: maskedPhone ?? '—' })
          : t('bindPhoneHint')}
      </p>

      <div className="mt-5 max-w-sm space-y-4">
        <Field label={t('phone')} htmlFor="bindPhone" required>
          <Input
            id="bindPhone"
            name="phone"
            type="tel"
            inputMode="numeric"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="09xxxxxxxx"
            required
          />
        </Field>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Field label={t('otpCode')} htmlFor="bindCode" required>
              <Input
                id="bindCode"
                name="code"
                inputMode="numeric"
                maxLength={6}
                disabled={!sent}
                required
              />
            </Field>
          </div>
          <Button
            type="button"
            variant="subtle"
            onClick={sendCode}
            disabled={sending || cooldown > 0 || phone.length < 10}
          >
            {cooldown > 0 ? `${cooldown}s` : t('sendOtp')}
          </Button>
        </div>
      </div>

      <Button type="submit" className="mt-6" disabled={pending || !sent}>
        {pending ? t('verifying') : hasPhone ? t('changePhoneSubmit') : t('bindPhoneSubmit')}
      </Button>
    </form>
  )
}
