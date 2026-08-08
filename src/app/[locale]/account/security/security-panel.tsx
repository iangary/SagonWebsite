'use client'

import * as React from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { Check, KeyRound, Smartphone, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Field } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { setPassword, bindPhone, unlinkProvider, type ActionState } from '../actions'

const INITIAL: ActionState = { ok: false }

export function SecurityPanel({
  email,
  maskedPhone,
  hasGoogle,
  hasPassword,
  hasPhone,
  googleEnabled,
  isLastMethod,
}: {
  email: string | null
  maskedPhone: string | null
  hasGoogle: boolean
  hasPassword: boolean
  hasPhone: boolean
  googleEnabled: boolean
  isLastMethod: boolean
}) {
  return (
    <div className="space-y-5">
      <section className="border border-cream-200 bg-white p-6">
        <h2 className="text-sm tracking-[0.1em]">登入方式</h2>
        <p className="mt-2 text-xs text-taupe-500">
          您可以同時綁定多種登入方式。至少要保留一種，才不會無法登入。
        </p>

        <ul className="mt-5 divide-y divide-cream-100">
          <MethodRow
            icon={<Link2 size={16} strokeWidth={1.5} />}
            title="Google 帳號"
            status={hasGoogle ? '已綁定' : '未綁定'}
            active={hasGoogle}
            action={
              googleEnabled ? (
                <GoogleBinding hasGoogle={hasGoogle} isLastMethod={isLastMethod} />
              ) : (
                <span className="text-xs text-taupe-400">未設定 Google OAuth</span>
              )
            }
          />
          <MethodRow
            icon={<KeyRound size={16} strokeWidth={1.5} />}
            title="Email 與密碼"
            status={hasPassword ? `已設定（${email ?? '—'}）` : email ? '尚未設定密碼' : '尚未設定 Email'}
            active={hasPassword}
          />
          <MethodRow
            icon={<Smartphone size={16} strokeWidth={1.5} />}
            title="手機驗證碼"
            status={hasPhone ? `已綁定（${maskedPhone}）` : '未綁定'}
            active={hasPhone}
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
  action,
}: {
  icon: React.ReactNode
  title: string
  status: string
  active: boolean
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
            啟用中
          </Badge>
        )}
        {action}
      </div>
    </li>
  )
}

function GoogleBinding({
  hasGoogle,
  isLastMethod,
}: {
  hasGoogle: boolean
  isLastMethod: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, setPending] = React.useState(false)

  async function unlink() {
    if (!window.confirm('確定要解除 Google 綁定嗎？')) return
    setPending(true)
    const result = await unlinkProvider('google')
    setPending(false)

    if (!result.ok) {
      toast(result.error ?? '解除綁定失敗', 'error')
      return
    }
    toast('已解除 Google 綁定')
    router.refresh()
  }

  if (!hasGoogle) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => signIn('google', { redirectTo: '/account/security' })}
      >
        綁定
      </Button>
    )
  }

  return (
    <Button size="sm" variant="ghost" disabled={pending || isLastMethod} onClick={unlink}>
      {isLastMethod ? '唯一登入方式' : '解除綁定'}
    </Button>
  )
}

function PasswordSection({ hasPassword }: { hasPassword: boolean }) {
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
      <h2 className="text-sm tracking-[0.1em]">{hasPassword ? '變更密碼' : '設定密碼'}</h2>
      <p className="mt-2 text-xs text-taupe-500">
        {hasPassword
          ? '變更後，舊密碼將立即失效。'
          : '設定密碼後，就能用 Email 加密碼登入這個帳號。'}
      </p>

      <div className="mt-5 grid max-w-sm gap-4">
        {hasPassword && (
          <Field
            label="目前密碼"
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
          label="新密碼"
          htmlFor="newPassword"
          required
          error={errors.newPassword}
          hint="至少 8 個字元"
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
          label="確認新密碼"
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
        {pending ? '處理中…' : hasPassword ? '變更密碼' : '設定密碼'}
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
        toast(data.error ?? '發送失敗', 'error')
        if (data.retryAfterSeconds) setCooldown(data.retryAfterSeconds)
        return
      }

      setSent(true)
      setCooldown(RESEND_SECONDS)
      toast(data.devCode ? `驗證碼已發送（開發模式：${data.devCode}）` : '驗證碼已發送')
    } finally {
      setSending(false)
    }
  }

  return (
    <form action={formAction} className="border border-cream-200 bg-white p-6">
      <h2 className="text-sm tracking-[0.1em]">{hasPhone ? '更換手機號碼' : '綁定手機號碼'}</h2>
      <p className="mt-2 text-xs text-taupe-500">
        {hasPhone
          ? `目前綁定 ${maskedPhone}。更換後將以新號碼登入。`
          : '綁定後可以用手機號碼加驗證碼登入，不需要記密碼。'}
      </p>

      <div className="mt-5 max-w-sm space-y-4">
        <Field label="手機號碼" htmlFor="bindPhone" required>
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
            <Field label="驗證碼" htmlFor="bindCode" required>
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
            {cooldown > 0 ? `${cooldown}s` : '發送驗證碼'}
          </Button>
        </div>
      </div>

      <Button type="submit" className="mt-6" disabled={pending || !sent}>
        {pending ? '驗證中…' : hasPhone ? '更換手機' : '綁定手機'}
      </Button>
    </form>
  )
}
