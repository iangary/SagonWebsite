'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import * as Dialog from '@radix-ui/react-dialog'
import { RefreshCw, Code, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { retryWebhook } from './actions'

export function WebhookRetry({ eventId }: { eventId: string }) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, setPending] = React.useState(false)

  async function retry() {
    setPending(true)
    const result = await retryWebhook(eventId)
    setPending(false)

    if (!result.ok) {
      toast(result.error ?? '重送失敗', 'error')
      router.refresh()
      return
    }
    toast('已重新處理完成')
    router.refresh()
  }

  return (
    <Button size="sm" variant="ghost" disabled={pending} onClick={retry}>
      <RefreshCw size={13} className={pending ? 'animate-spin' : undefined} />
      重送
    </Button>
  )
}

export function WebhookPayload({ payload }: { payload: string }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <Button size="sm" variant="ghost">
          <Code size={13} />
          內容
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-70 bg-ink-900/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-80 max-h-[80vh] w-[min(90vw,720px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden border border-cream-300 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-cream-200 px-5 py-3">
            <Dialog.Title className="text-sm tracking-[0.1em]">原始 Payload</Dialog.Title>
            <Dialog.Close aria-label="關閉" className="text-taupe-500 hover:text-ink-900">
              <X size={18} />
            </Dialog.Close>
          </div>
          <pre className="max-h-[65vh] overflow-auto bg-cream-50 p-5 font-mono text-xs leading-relaxed text-ink-700">
            {payload}
          </pre>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
