'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input, Field } from '@/components/ui/input'
import { completePasswordSetup, type SetPasswordState } from './actions'

export function SetPasswordForm({
  maskedPhone,
  alreadyHasPassword,
}: {
  maskedPhone: string | null
  /** token 還說要設密碼、但帳號其實已經有了。只需要一顆按鈕解鎖，不要再問密碼 */
  alreadyHasPassword: boolean
}) {
  const t = useTranslations('auth')
  const [state, setState] = React.useState<SetPasswordState>({ ok: false })
  const [pending, setPending] = React.useState(false)

  /**
   * token 上的 needsPassword 與離開這道門都由 action 在 server 端處理
   * （見 ./actions.ts 的 leaveGate），這裡只負責把錯誤顯示出來。
   */
  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    const result = await completePasswordSetup(new FormData(event.currentTarget))

    if (!result.ok) {
      setPending(false)
      setState(result)
      return
    }

    // 用整頁載入離開這道門：client-side 導向可能沿用「換 cookie 之前」算出來的
    // RSC 快取，整頁請求才保證 proxy 拿新 cookie 重新判斷一次。
    // 這一步剛換掉 session cookie，router.push 可能沿用舊 cookie 算出來的 RSC 結果，
    // 所以刻意用整頁載入而不是 router.push。
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign('/account/orders')
  }

  const errors = state.fieldErrors ?? {}

  if (alreadyHasPassword) {
    return (
      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        {state.error && (
          <p role="alert" className="border border-sale/30 bg-sale/5 px-3 py-2 text-sm text-sale">
            {state.error}
          </p>
        )}
        <Button type="submit" full disabled={pending}>
          {pending ? t('processing') : t('setPasswordContinue')}
        </Button>
      </form>
    )
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-4">
      {state.error && (
        <p role="alert" className="border border-sale/30 bg-sale/5 px-3 py-2 text-sm text-sale">
          {state.error}
        </p>
      )}

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

      <Button type="submit" full disabled={pending}>
        {pending ? t('processing') : t('setPasswordSubmit')}
      </Button>

      {maskedPhone && (
        <p className="text-center text-xs text-taupe-500">
          {t('setPasswordAccountHint', { phone: maskedPhone })}
        </p>
      )}
    </form>
  )
}
