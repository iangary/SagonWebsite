import { NextResponse } from 'next/server'
import { chatViewer, findViewerConversationId } from '@/lib/chat'
import { chatEventStream } from '@/lib/chat/stream'

export const dynamic = 'force-dynamic'

/**
 * 訪客端的聊天串流。
 *
 * 對話 id 一律由伺服器依 cookie / session 決定，不接受用 query 指定 ——
 * 否則任何人都能用別人的 conversationId 偷看對話。
 *
 * 還沒有任何對話的訪客會拿到 204，聊天視窗就只顯示歡迎詞，
 * 等他送出第一則訊息之後再重連。
 */
export async function GET(request: Request) {
  const viewer = await chatViewer()
  if (!viewer.userId && !viewer.anonId) {
    return NextResponse.json({ error: 'no identity' }, { status: 400 })
  }

  const conversationId = await findViewerConversationId(viewer)
  if (!conversationId) return new NextResponse(null, { status: 204 })

  const { searchParams } = new URL(request.url)

  return chatEventStream({
    conversationId,
    since: searchParams.get('since'),
    audience: 'customer',
    signal: request.signal,
  })
}
