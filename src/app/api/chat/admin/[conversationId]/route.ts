import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { currentUser } from '@/lib/auth'
import { chatEventStream } from '@/lib/chat/stream'

export const dynamic = 'force-dynamic'

/**
 * 後台對話頁的即時串流。
 *
 * proxy.ts 只擋 /admin，API 路徑不在它的 matcher 裡，所以這裡必須自己驗身分。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const user = await currentUser()
  if (!user || user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { conversationId } = await params

  const exists = await db.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true },
  })
  if (!exists) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const { searchParams } = new URL(request.url)

  return chatEventStream({
    conversationId,
    since: searchParams.get('since'),
    audience: 'agent',
    signal: request.signal,
  })
}
