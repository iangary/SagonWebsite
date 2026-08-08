import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requestOtp } from '@/lib/auth/otp'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  phone: z.string().min(1),
  purpose: z.enum(['login', 'bind']).default('login'),
})

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: '參數格式錯誤' }, { status: 400 })
  }

  const result = await requestOtp(parsed.data.phone, parsed.data.purpose)

  if (!result.ok) {
    const messages = {
      invalid_phone: '請輸入正確的台灣手機號碼（09 開頭共 10 碼）',
      cooldown: `請稍候 ${result.retryAfterSeconds} 秒後再重新發送`,
      rate_limited: '索取次數過於頻繁，請一小時後再試',
    } as const
    return NextResponse.json(
      { ok: false, error: messages[result.reason], retryAfterSeconds: result.retryAfterSeconds },
      { status: result.reason === 'invalid_phone' ? 400 : 429 },
    )
  }

  return NextResponse.json({
    ok: true,
    cooldownSeconds: result.cooldownSeconds,
    // 只在開發環境把驗證碼回傳到前端，方便本機測試；正式環境永遠沒有這個欄位
    ...(env.NODE_ENV !== 'production' && result.devCode ? { devCode: result.devCode } : {}),
  })
}
