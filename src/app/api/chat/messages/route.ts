import { NextResponse } from 'next/server'
import { z } from 'zod'
import { chatViewer, postCustomerMessage, toWire } from '@/lib/chat'
import { MAX_MESSAGE_LENGTH } from '@/lib/chat/cursor'

export const dynamic = 'force-dynamic'

const payloadSchema = z.object({
  body: z.string().min(1).max(MAX_MESSAGE_LENGTH * 2),
  guestName: z.string().max(120).optional(),
  guestContact: z.string().max(200).optional(),
})

/** 拒絕的原因對照訊息。前端直接顯示這裡的字。 */
const MESSAGES: Record<string, { status: number; message: string }> = {
  EMPTY: { status: 400, message: '請輸入訊息內容' },
  NO_IDENTITY: { status: 400, message: '無法識別瀏覽器，請重新整理頁面後再試' },
  RATE_LIMITED: { status: 429, message: '訊息送太快了，請稍等一下再送' },
  CLOSED: { status: 409, message: '這則對話已結束' },
}

export async function POST(request: Request) {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: '格式錯誤' }, { status: 400 })
  }

  const parsed = payloadSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ error: '請輸入訊息內容' }, { status: 400 })
  }

  const viewer = await chatViewer()

  try {
    const result = await postCustomerMessage({
      viewer,
      body: parsed.data.body,
      guestName: parsed.data.guestName ?? null,
      guestContact: parsed.data.guestContact ?? null,
    })

    if (!result.ok) {
      const failure = MESSAGES[result.error]
      return NextResponse.json({ error: failure.message }, { status: failure.status })
    }

    return NextResponse.json(
      { conversationId: result.conversationId, message: toWire(result.message) },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error('[chat] 訪客送出訊息失敗', error)
    return NextResponse.json({ error: '暫時無法送出訊息，請稍後再試' }, { status: 500 })
  }
}
