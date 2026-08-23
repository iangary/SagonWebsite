import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requestOtp } from '@/lib/auth/otp'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  phone: z.string().min(1),
  purpose: z.enum(['login', 'bind', 'reset']).default('login'),
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
      use_password: '這支號碼已經設定過密碼，請直接用手機號碼與密碼登入',
      no_account: '這支號碼還沒有帳號，請改用手機驗證碼登入（會直接為你建立會員）',
      cooldown: `請稍候 ${result.retryAfterSeconds} 秒後再重新發送`,
      rate_limited: '索取次數過於頻繁，請一小時後再試',
      sms_failed: '簡訊服務暫時無法使用，請稍後再試或改用密碼登入',
    } as const
    // 400 使用者輸入錯、409 帳號狀態不符（該走另一條路）、429 節流、
    // 503 我們這邊的問題（簡訊供應商發不出去）
    const status = {
      invalid_phone: 400,
      use_password: 409,
      no_account: 409,
      cooldown: 429,
      rate_limited: 429,
      sms_failed: 503,
    } as const
    return NextResponse.json(
      {
        ok: false,
        // reason 給前端分流用（例如 use_password 要顯示「忘記密碼」入口），
        // error 是已經翻好的字，前端不必自己對照。
        reason: result.reason,
        error: messages[result.reason],
        retryAfterSeconds: result.retryAfterSeconds,
      },
      { status: status[result.reason] },
    )
  }

  return NextResponse.json({
    ok: true,
    cooldownSeconds: result.cooldownSeconds,
    // 只在開發環境把驗證碼回傳到前端，方便本機測試；正式環境永遠沒有這個欄位
    ...(env.NODE_ENV !== 'production' && result.devCode ? { devCode: result.devCode } : {}),
  })
}
