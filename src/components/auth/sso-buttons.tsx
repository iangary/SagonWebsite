'use client'

import * as React from 'react'
import { signIn } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import type { SsoProviderId } from '@/lib/auth/sso'

/**
 * 登入頁與註冊頁共用的第三方登入按鈕。
 *
 * providers 由 server component 從 env.enabledSsoProviders 傳進來 ——
 * 沒設定憑證的 provider 不會出現，整組都沒有時連分隔線都不畫。
 */
export function SsoButtons({
  providers,
  callbackUrl,
}: {
  providers: SsoProviderId[]
  callbackUrl: string
}) {
  const t = useTranslations('auth')

  if (providers.length === 0) return null

  return (
    <>
      <div className="space-y-3">
        {providers.map((id) => (
          <Button
            key={id}
            variant="outline"
            full
            onClick={() => signIn(id, { redirectTo: callbackUrl })}
          >
            <SsoMark id={id} />
            {t(LABEL_KEYS[id])}
          </Button>
        ))}
      </div>

      <div className="flex items-center gap-3 text-xs text-taupe-400">
        <span className="h-px flex-1 bg-cream-200" />
        {t('orDivider')}
        <span className="h-px flex-1 bg-cream-200" />
      </div>
    </>
  )
}

const LABEL_KEYS = {
  google: 'continueWithGoogle',
  line: 'continueWithLine',
  facebook: 'continueWithFacebook',
} as const satisfies Record<SsoProviderId, string>

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

function LineMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#06C755"
        d="M12 2C6.48 2 2 5.64 2 10.12c0 4.01 3.55 7.37 8.35 8.01.32.07.77.21.88.49.1.25.07.65.03.9l-.14.85c-.04.25-.2.98.86.53s5.7-3.36 7.78-5.75C21.13 13.6 22 11.98 22 10.12 22 5.64 17.52 2 12 2Z"
      />
      <path
        fill="#fff"
        d="M8.35 7.87h-.7a.2.2 0 0 0-.2.2v4.36c0 .1.09.19.2.19h.7c.1 0 .19-.08.19-.19V8.07a.2.2 0 0 0-.2-.2Zm4.83 0h-.7a.2.2 0 0 0-.2.2v2.59l-2-2.7-.02-.01v-.01l-.02-.01-.01-.01h-.02l-.01-.01h-.75a.2.2 0 0 0-.2.2v4.36c0 .1.09.19.2.19h.7c.11 0 .2-.08.2-.19v-2.59l2 2.7.05.05h.05l.05.01h.68c.1 0 .2-.08.2-.19V8.07a.2.2 0 0 0-.2-.2Zm-6.52 3.65H4.75V8.07a.2.2 0 0 0-.19-.2h-.7a.2.2 0 0 0-.2.2v4.36c0 .05.02.1.06.13.03.04.08.06.13.06h2.8c.11 0 .2-.09.2-.2v-.7a.2.2 0 0 0-.2-.2Zm10.4-3.65h-2.8a.2.2 0 0 0-.2.2v4.36c0 .1.09.19.2.19h2.8c.11 0 .2-.08.2-.19v-.7a.2.2 0 0 0-.2-.2h-1.91v-.74h1.91c.11 0 .2-.09.2-.2v-.7a.2.2 0 0 0-.2-.2h-1.91v-.73h1.91c.11 0 .2-.09.2-.2v-.7a.2.2 0 0 0-.2-.19Z"
      />
    </svg>
  )
}

function FacebookMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#1877F2"
        d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.91h2.54V9.85c0-2.52 1.49-3.91 3.77-3.91 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.78-1.63 1.57v1.89h2.78l-.45 2.91h-2.33V22c4.78-.76 8.44-4.92 8.44-9.94Z"
      />
      <path
        fill="#fff"
        d="m15.89 14.97.45-2.91h-2.78v-1.89c0-.79.39-1.57 1.63-1.57h1.26V6.14s-1.15-.2-2.24-.2c-2.28 0-3.77 1.39-3.77 3.91v2.21H7.9v2.91h2.54V22a10.1 10.1 0 0 0 3.12 0v-7.03h2.33Z"
      />
    </svg>
  )
}

const MARKS: Record<SsoProviderId, () => React.ReactElement> = {
  google: GoogleMark,
  line: LineMark,
  facebook: FacebookMark,
}

/** 品牌圖示。帳號安全頁的登入方式列表也用這個，所以對外匯出。 */
export function SsoMark({ id }: { id: SsoProviderId }) {
  const Mark = MARKS[id]
  return <Mark />
}
