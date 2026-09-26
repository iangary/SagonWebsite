'use client'

import * as React from 'react'
import { MailWarning } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { resendEmailVerification } from './actions'

/**
 * 「信箱尚未驗證」的提示條。
 *
 * 註冊時已自動寄過一次驗證信，這裡只負責告知狀態與提供重寄 ——
 * 未驗證不影響登入或購買，所以是提示而不是攔截。
 */
export function EmailVerificationNotice({
  labels,
}: {
  /** 字串在 server 就翻好傳進來（含帶入信箱的 hint），leaf component 不再碰 next-intl */
  labels: { title: string; hint: string; resend: string; sending: string }
}) {
  const { toast } = useToast()
  const [pending, setPending] = React.useState(false)

  async function resend() {
    setPending(true)
    const result = await resendEmailVerification()
    setPending(false)
    toast(result.error ?? result.message ?? labels.title, result.ok ? 'success' : 'error')
  }

  return (
    <div
      role="status"
      className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 border border-cream-200 bg-cream-50 px-4 py-3.5"
    >
      <div className="flex min-w-0 items-start gap-3">
        <MailWarning size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-taupe-500" />
        <div className="min-w-0">
          <p className="text-sm text-ink-900">{labels.title}</p>
          <p className="mt-0.5 break-words text-xs text-taupe-500">{labels.hint}</p>
        </div>
      </div>
      <Button size="sm" variant="outline" className="ml-auto shrink-0" onClick={resend} disabled={pending}>
        {pending ? labels.sending : labels.resend}
      </Button>
    </div>
  )
}
