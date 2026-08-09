import Link from 'next/link'
import type { ChatStatus, Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { cn } from '@/lib/utils'
import { CONVERSATION_SUMMARY_SELECT } from '@/lib/chat'
import { PageHeader, DataTable, Td, AdminPagination } from '@/components/admin/ui'
import { Badge } from '@/components/ui/badge'

export const dynamic = 'force-dynamic'
export const metadata = { title: '客服訊息' }

const PER_PAGE = 30

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

/** 訪客顯示名稱：會員優先用帳號資料，未登入的用他自己留的稱呼。 */
function displayName(conversation: {
  guestName: string | null
  user: { name: string | null; email: string | null; phone: string | null } | null
}): string {
  const { user } = conversation
  return (
    user?.name ?? user?.email ?? user?.phone ?? conversation.guestName ?? '訪客'
  )
}

export default async function AdminChatPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>
}) {
  const sp = await searchParams
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1)

  const where: Prisma.ConversationWhereInput = {}
  if (sp.status && sp.status in STATUS_LABEL) where.status = sp.status as ChatStatus

  const [conversations, total, waitingCount] = await Promise.all([
    db.conversation.findMany({
      where,
      // 待回覆的排最前面，其餘照最後發言時間
      orderBy: [{ unreadForAgent: 'desc' }, { lastMessageAt: 'desc' }],
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      select: CONVERSATION_SUMMARY_SELECT,
    }),
    db.conversation.count({ where }),
    db.conversation.count({ where: { unreadForAgent: { gt: 0 } } }),
  ])

  return (
    <>
      <PageHeader
        title="客服訊息"
        description={waitingCount > 0 ? `${waitingCount} 則等待回覆` : '目前沒有待回覆的訊息'}
      />

      <div className="mb-5 flex gap-2">
        {[
          { value: '', label: '全部' },
          ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label })),
        ].map((filter) => (
          <Link
            key={filter.value || 'all'}
            href={filter.value ? `/admin/chat?status=${filter.value}` : '/admin/chat'}
            className={cn(
              'border px-3 py-1.5 text-xs transition-colors',
              (sp.status ?? '') === filter.value
                ? 'border-ink-900 bg-ink-900 text-cream-50'
                : 'border-cream-300 text-ink-700 hover:border-taupe-400',
            )}
          >
            {filter.label}
          </Link>
        ))}
      </div>

      <DataTable
        headers={['訪客', '最後訊息', '聯絡方式', '狀態', '未讀', '時間']}
        empty={conversations.length === 0}
      >
        {conversations.map((conversation) => (
          <tr key={conversation.id} className="hover:bg-cream-50">
            <Td>
              <Link
                href={`/admin/chat/${conversation.id}`}
                className="text-ink-900 underline underline-offset-4"
              >
                {displayName(conversation)}
              </Link>
              {!conversation.user && (
                <span className="ml-2 text-xs text-taupe-500">未登入</span>
              )}
            </Td>
            <Td className="max-w-80">
              <span className="line-clamp-2 text-xs text-taupe-600">
                {conversation.lastMessageText ?? '—'}
              </span>
            </Td>
            <Td className="text-xs text-taupe-600">
              {conversation.user?.email ??
                conversation.user?.phone ??
                conversation.guestContact ??
                '—'}
            </Td>
            <Td>
              <Badge tone={STATUS_TONE[conversation.status]}>
                {STATUS_LABEL[conversation.status]}
              </Badge>
            </Td>
            <Td className="tabular-nums">
              {conversation.unreadForAgent > 0 ? (
                <span className="text-sale">{conversation.unreadForAgent}</span>
              ) : (
                <span className="text-taupe-500">0</span>
              )}
            </Td>
            <Td className="whitespace-nowrap text-xs text-taupe-500">
              {conversation.lastMessageAt.toLocaleString('zh-TW', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Td>
          </tr>
        ))}
      </DataTable>

      <AdminPagination
        page={page}
        totalPages={Math.max(1, Math.ceil(total / PER_PAGE))}
        basePath="/admin/chat"
        searchParams={sp}
      />
    </>
  )
}
