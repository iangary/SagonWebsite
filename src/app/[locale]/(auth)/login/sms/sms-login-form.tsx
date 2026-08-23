'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { getCsrfToken, signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Link } from '@/i18n/routing'
import { Button } from '@/components/ui/button'
import { Input, Field } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { notifyCartChanged } from '@/components/cart/cart-count-provider'
import { cn } from '@/lib/utils'

const RESEND_SECONDS = 60

/**
 * 第一次用手機登入（等同註冊）。
 *
 * 只有「號碼還沒有帳號」或「有帳號但還沒設密碼」才發得出驗證碼；已經設過密碼的號碼
 * 會被後端擋掉（reason=use_password），這裡把「忘記密碼」的入口指給他。
 * 登入成功後 proxy 會把還沒有密碼的人擋在 /set-password，設完就改用號碼＋密碼登入。
 */
export function SmsLoginForm({ callbackUrl }: { callbackUrl: string }) {
  const t = useTranslations('auth')
  const router = useRouter()
  const { toast } = useToast()

  const [phone, setPhone] = React.useState('')
  const [sent, setSent] = React.useState(false)
  const [cooldown, setCooldown] = React.useState(0)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | undefined>(undefined)
  const [needsPassword, setNeedsPassword] = React.useState(false)

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
    setError(undefined)
    setPending(true)
    try {
      const res = await fetch('/api/auth/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, purpose: 'login' }),
      })
      const data = (await res.json()) as {
        ok: boolean
        reason?: string
        error?: string
        devCode?: string
        retryAfterSeconds?: number
      }

      if (!data.ok) {
        setError(data.error ?? t('sendFailed'))
        // 這支號碼已經設過密碼 —— 平常不再發簡訊，把「忘記密碼」的入口指給他
        setNeedsPassword(data.reason === 'use_password')
        if (data.retryAfterSeconds) setCooldown(data.retryAfterSeconds)
        return
      }
      setNeedsPassword(false)

      setSent(true)
      setCooldown(RESEND_SECONDS)
      // 開發環境把驗證碼直接顯示出來，省去翻 log
      toast(data.devCode ? t('otpSentDev', { code: data.devCode }) : t('otpSent'))
    } finally {
      setPending(false)
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(undefined)
    setPending(true)

    // 先讀表單再 await：React 的事件過了 await 就沒有 currentTarget
    const code = String(new FormData(event.currentTarget).get('code') ?? '')
    await ensureCsrfCookie()

    const res = await signIn('phone-otp', { phone, code, redirect: false })

    setPending(false)
    if (res?.error) {
      setError(t('invalidOtp'))
      return
    }
    // 登入會把匿名購物車併進會員車，header 的數字要跟著重讀（見 login-form）
    notifyCartChanged()
    router.push(callbackUrl)
    router.refresh()
  }

  return (
    <div className="mt-8 space-y-6">
      {error && (
        <p role="alert" className="border border-sale/30 bg-sale/5 px-3 py-2 text-sm text-sale">
          {error}
        </p>
      )}

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

      <p className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-center text-sm text-taupe-500">
        {needsPassword && (
          <Link href="/forgot-password" className="text-ink-900 underline underline-offset-4">
            {t('forgotPassword')}
          </Link>
        )}
        <Link href="/login" className="underline underline-offset-4">
          {t('backToLogin')}
        </Link>
      </p>
    </div>
  )
}
