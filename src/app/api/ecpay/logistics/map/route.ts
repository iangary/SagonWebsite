import { NextResponse, type NextRequest } from 'next/server'
import type { LogisticsSubType } from '@prisma/client'
import { buildExpressMapParams, CVS_SUBTYPES } from '@/lib/ecpay/logistics'
import { renderAutoSubmitForm } from '@/lib/ecpay/auto-submit'

export const dynamic = 'force-dynamic'

const ALLOWED = new Set<string>(CVS_SUBTYPES.map((s) => s.value))

/**
 * 開啟綠界電子地圖讓消費者選門市。
 * 前端會用 window.open 開這支，選完後由 map-reply 把結果 postMessage 回結帳頁。
 */
export async function GET(req: NextRequest) {
  const subType = req.nextUrl.searchParams.get('subType') ?? 'UNIMARTC2C'
  if (!ALLOWED.has(subType)) {
    return NextResponse.json({ error: '不支援的超商類型' }, { status: 400 })
  }

  // 用一個隨機 token 當 ExtraData，選店結果回來時據此確認是這一次開的視窗
  const token = req.nextUrl.searchParams.get('token') ?? crypto.randomUUID()

  const { action, params } = buildExpressMapParams(subType as LogisticsSubType, token)

  return renderAutoSubmitForm({
    action,
    params,
    title: '選擇取貨門市',
    message: '正在開啟門市地圖…',
  })
}
