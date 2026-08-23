import { NextResponse, type NextRequest } from 'next/server'
import { consumeEmailVerification } from '@/lib/auth/email-verification'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'

/**
 * 驗證信裡的連結。
 *
 * 消耗 token 這個副作用刻意放在 route handler 而不是頁面 render 裡，
 * 然後 302 到結果頁 —— 這樣使用者的網址列與瀏覽紀錄裡不會留下 token。
 * 結果頁在 [locale] 底下，localePrefix 是 as-needed，中文站沒有前綴；
 * 信件內容本來就只有中文，固定導到預設語系。
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? ''
  const result = await consumeEmailVerification(token)

  const status = result.ok ? (result.alreadyVerified ? 'already' : 'ok') : result.reason

  return NextResponse.redirect(new URL(`/verify-email?status=${status}`, env.APP_URL))
}
