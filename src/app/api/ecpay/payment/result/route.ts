import { NextResponse, type NextRequest } from 'next/server'
import { env } from '@/lib/env'
import { readCallbackParams } from '@/lib/ecpay/webhook'

export const dynamic = 'force-dynamic'

/**
 * 綠界付款後把使用者的瀏覽器 POST 回這裡（OrderResultURL）。
 *
 * 這支只負責把人導到結果頁 —— 內容來自使用者的瀏覽器，不可信，
 * 絕對不能在這裡改訂單狀態。訂單狀態一律以 /api/ecpay/payment/return 為準。
 */
export async function POST(req: NextRequest) {
  const params = await readCallbackParams(req)
  const orderNo = params.MerchantTradeNo ?? ''

  const url = new URL('/checkout/result', env.APP_URL)
  if (orderNo) url.searchParams.set('orderNo', orderNo)

  // 303 讓瀏覽器把 POST 轉成 GET，否則結果頁會收到一個 POST
  return NextResponse.redirect(url, 303)
}

/** 使用者中途按上一頁之類的情況會變成 GET */
export async function GET(req: NextRequest) {
  const orderNo = req.nextUrl.searchParams.get('orderNo') ?? ''
  const url = new URL('/checkout/result', env.APP_URL)
  if (orderNo) url.searchParams.set('orderNo', orderNo)
  return NextResponse.redirect(url, 303)
}
