import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { CHAT_MESSAGE_SELECT, chatViewer, findViewerConversationId, toWire } from '@/lib/chat'
import { formatCursor } from '@/lib/chat/cursor'

export const dynamic = 'force-dynamic'

/**
 * 聊天視窗的開場資料。
 *
 * 存在的理由是 EventSource 沒辦法漂亮地處理「還沒有任何對話」——
 * 非 200 的回應會讓它永久斷線。所以先用這支普通的 JSON 端點問清楚狀態，
 * 有對話才去開 SSE，並用回傳的 cursor 避免歷史訊息被送第二次。
 *
 * 順便讓聊天鈕在面板關著時也知道要不要顯示紅點。
 */
export async function GET() {
  const viewer = await chatViewer()
  if (!viewer.userId && !viewer.anonId) {
    return NextResponse.json({ error: 'no identity' }, { status: 400 })
  }

  const conversationId = await findViewerConversationId(viewer)
  if (!conversationId) {
    return NextResponse.json(
      { conversationId: null, messages: [], cursor: null, unread: 0 },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const [conversation, messages] = await Promise.all([
    db.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: { status: true, unreadForCustomer: true },
    }),
    // 只回最近 50 則。客服對話拉太長對訪客沒意義，也省流量。
    db.chatMessage.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
      select: CHAT_MESSAGE_SELECT,
    }),
  ])

  const ordered = messages.reverse()
  const last = ordered.at(-1)

  return NextResponse.json(
    {
      conversationId,
      status: conversation.status,
      unread: conversation.unreadForCustomer,
      cursor: last ? formatCursor({ createdAt: last.createdAt, id: last.id }) : null,
      messages: ordered.map(toWire),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
