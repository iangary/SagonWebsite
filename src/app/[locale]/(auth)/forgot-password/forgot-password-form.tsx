'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { getCsrfToken, signIn } from 'next-auth/react'
import { Link } from '@/i18n/routing'
import { Button } from '@/components/ui/button'
import { Input, Field } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { resetPasswordByOtp, type ResetPasswordState } from './actions'

const RESEND_SECONDS = 60

/**
 * 忘記密碼：手機號碼 → 索取驗證碼 → 驗證碼＋新密碼 → 重設完成後直接登入。
 *
 * 這是已經設過密碼的人唯一還會收到簡訊的地方（平常登入走密碼，不發簡訊）。
 *
 * 刻意不用 useActionState：form action 跑完 React 會把未受控欄位清掉，
 * 之後在 effect 裡從 DOM 讀新密碼會讀到空字串，自動登入就失敗。
 * 密碼在同一個 handler 裡拿在手上才可靠。
 */
export function ForgotPasswordForm() {
  const t = useTranslations('auth')
  const { toast } = useToast()

  const [phone, setPhone] = React.useState('')
  const [sent, setSent] = React.useState(false)
  const [cooldown, setCooldown] = React.useState(0)
  const [pending, setPending] = React.useState(false)
  const [state, setState] = React.useState<ResetPasswordState>({ ok: false })
  const [sendError, setSendError] = React.useState<string | undefined>(undefined)

    React.useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

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

  async function sendCode() {
    setSendError(undefined)
    setPending(true)
    try {
      const res = await fetch('/api/auth/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, purpose: 'reset' }),
      })
      const data = (await res.json()) as {
        ok: boolean
        error?: string
        devCode?: string
        retryAfterSeconds?: number
      }

      if (!data.ok) {
        setSendError(data.error ?? t('sendFailed'))
        if (data.retryAfterSeconds) setCooldown(data.retryAfterSeconds)
        return
      }

      setSent(true)
      setCooldown(RESEND_SECONDS)
      toast(data.devCode ? t('otpSentDev', { code: data.devCode }) : t('otpSent'))
    } finally {
      setPending(false)
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSendError(undefined)
    setPending(true)

    const formData = new FormData(event.currentTarget)
    const password = String(formData.get('password') ?? '')
    const result = await resetPasswordByOtp(formData)

    if (!result.ok || !result.phone) {
      setPending(false)
      setState(result)
      return
    }

    // 重設完就用新密碼登入，不要再叫他輸入一次
    await ensureCsrfCookie()
    const signInResult = await signIn('password', {
      identifier: result.phone,
      password,
      redirect: false,
    })

    if (signInResult?.error) {
      // 密碼確實換好了，只是自動登入沒成功 —— 讓他自己去登入頁，不要留在這裡重設第二次
      setPending(false)
      setState({ ok: false, error: t('resetDoneLoginManually') })
      return
    }

    // 整頁載入：讓 proxy 拿新的 session cookie 重新判斷一次
    // 這一步剛換掉 session cookie，router.push 可能沿用舊 cookie 算出來的 RSC 結果，
    // 所以刻意用整頁載入而不是 router.push。
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign('/account/orders')
  }

  const errors = state.fieldErrors ?? {}
  const error = sendError ?? state.error

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-4">
      {error && (
        <p role="alert" className="border border-sale/30 bg-sale/5 px-3 py-2 text-sm text-sale">
          {error}
        </p>
      )}

      <Field label={t('phone')} htmlFor="phone" required hint={t('phoneHint')} error={errors.phone}>
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

      <Field
        label={t('newPassword')}
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
          disabled={!sent}
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
          disabled={!sent}
          required
        />
      </Field>

      <Button type="submit" full disabled={pending || !sent}>
        {pending ? t('processing') : t('resetPasswordSubmit')}
      </Button>

      <p className="text-center text-sm text-taupe-500">
        <Link href="/login" className="text-ink-900 underline underline-offset-4">
          {t('backToLogin')}
        </Link>
      </p>
    </form>
  )
}
