import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
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
  // requireAdmin 會再問一次資料庫：token 上的 role 最多舊 5 分鐘，撤權要當下生效
  try {
    await requireAdmin()
  } catch {
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
