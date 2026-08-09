import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import type { ChatStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { CHAT_MESSAGE_SELECT, markReadForAgent, toWire } from '@/lib/chat'
import { formatCursor } from '@/lib/chat/cursor'
import { PageHeader } from '@/components/admin/ui'
import { Badge } from '@/components/ui/badge'
import { ConversationThread } from './conversation-thread'
import { ConversationStatusControl } from './conversation-status-control'

export const dynamic = 'force-dynamic'
export const metadata = { title: '客服對話' }

const STATUS_LABEL: Record<ChatStatus, string> = {
  OPEN: '待回覆',
  ANSWERED: '已回覆',
  CLOSED: '已結案',
}

const STATUS_TONE: Record<ChatStatus, 'warning' | 'success' | 'muted'> = {
  OPEN: 'warning',
  ANSWERED: 'success',
  CLOSED: 'muted',
}

export default async function AdminConversationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const conversation = await db.conversation.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      guestName: true,
      guestContact: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true, phone: true } },
      messages: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: CHAT_MESSAGE_SELECT,
      },
    },
  })

  if (!conversation) notFound()

  // 客服打開對話就算讀過了
  await markReadForAgent(id)

  const last = conversation.messages.at(-1)
  const cursor = last ? formatCursor({ createdAt: last.createdAt, id: last.id }) : null

  const visitor =
    conversation.user?.name ??
    conversation.user?.email ??
    conversation.user?.phone ??
    conversation.guestName ??
    '訪客'

  const contact =
    conversation.user?.email ?? conversation.user?.phone ?? conversation.guestContact ?? null

  return (
    <>
      <PageHeader
        title={visitor}
        description={[
          contact,
          conversation.user ? '會員' : '未登入訪客',
          `建立於 ${conversation.createdAt.toLocaleString('zh-TW')}`,
        ]
          .filter(Boolean)
          .join('　·　')}
        action={
          <div className="flex items-center gap-3">
            <Badge tone={STATUS_TONE[conversation.status]}>
              {STATUS_LABEL[conversation.status]}
            </Badge>
            <ConversationStatusControl
              conversationId={conversation.id}
              status={conversation.status}
            />
          </div>
        }
      />

      <Link
        href="/admin/chat"
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-taupe-600 hover:text-ink-900"
      >
        <ArrowLeft size={14} strokeWidth={1.5} />
        回到列表
      </Link>

      {contact && (
        <p className="mb-5 text-xs text-taupe-600">
          <Link
            href={`/admin/orders?q=${encodeURIComponent(contact)}`}
            className="underline underline-offset-4"
          >
            用這組聯絡方式查訂單
          </Link>
        </p>
      )}

      <ConversationThread
        conversationId={conversation.id}
        initialMessages={conversation.messages.map(toWire)}
        initialCursor={cursor}
        closed={conversation.status === 'CLOSED'}
      />
    </>
  )
}
