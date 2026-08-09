'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { ChatStatus } from '@prisma/client'
import { CheckCircle2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { updateConversationStatus } from '../actions'

export function ConversationStatusControl({
  conversationId,
  status,
}: {
  conversationId: string
  status: ChatStatus
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, setPending] = React.useState(false)

  const next = status === 'CLOSED' ? 'OPEN' : 'CLOSED'

  async function apply() {
    setPending(true)
    const result = await updateConversationStatus(conversationId, next)
    setPending(false)

    if (!result.ok) {
      toast(result.error, 'error')
      return
    }
    toast(result.message)
    router.refresh()
  }

  return (
    <Button size="sm" variant="ghost" disabled={pending} onClick={() => apply()}>
      {next === 'CLOSED' ? <CheckCircle2 size={14} /> : <RotateCcw size={14} />}
      {next === 'CLOSED' ? '標記結案' : '重新開啟'}
    </Button>
  )
}
