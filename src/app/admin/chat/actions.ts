'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { postAgentMessage, setConversationStatus } from '@/lib/chat'
import { MAX_MESSAGE_LENGTH } from '@/lib/chat/cursor'

export type AdminActionResult = { ok: true; message: string } | { ok: false; error: string }

const replySchema = z.object({
  conversationId: z.string().min(1),
  body: z.string().min(1).max(MAX_MESSAGE_LENGTH * 2),
})

export async function replyToConversation(input: {
  conversationId: string
  body: string
}): Promise<AdminActionResult> {
  const admin = await requireAdmin()

  const parsed = replySchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: '請輸入回覆內容' }

  try {
    const result = await postAgentMessage({
      conversationId: parsed.data.conversationId,
      authorId: admin.id,
      body: parsed.data.body,
    })

    if (!result.ok) {
      return { ok: false, error: result.error === 'EMPTY' ? '請輸入回覆內容' : '找不到這則對話' }
    }

    revalidatePath('/admin/chat')
    revalidatePath(`/admin/chat/${parsed.data.conversationId}`)
    return { ok: true, message: '已送出回覆' }
  } catch (error) {
    console.error('[admin] 客服回覆失敗', error)
    return { ok: false, error: '暫時無法送出回覆，請稍後再試' }
  }
}

export async function updateConversationStatus(
  conversationId: string,
  status: 'OPEN' | 'CLOSED',
): Promise<AdminActionResult> {
  const admin = await requireAdmin()

  try {
    await setConversationStatus(conversationId, status)

    await audit({
      userId: admin.id,
      action: `chat.${status === 'CLOSED' ? 'close' : 'reopen'}`,
      entity: 'Conversation',
      entityId: conversationId,
      after: { status },
    })

    revalidatePath('/admin/chat')
    revalidatePath(`/admin/chat/${conversationId}`)
    return { ok: true, message: status === 'CLOSED' ? '已結案' : '已重新開啟' }
  } catch (error) {
    console.error('[admin] 更新對話狀態失敗', error)
    return { ok: false, error: (error as Error).message }
  }
}
