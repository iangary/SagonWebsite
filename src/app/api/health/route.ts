import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * 給 docker healthcheck 與負載平衡器用。DB 連不上就回 503。
 *
 * 這支對外公開，錯誤細節只寫進 log —— Prisma 的錯誤訊息會帶主機名稱、連接埠、
 * 資料庫名稱，對外講等於替攻擊者畫網路圖。
 */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`
    return NextResponse.json({ status: 'ok', db: 'up' })
  } catch (error) {
    console.error('[health] 資料庫連線失敗：', error)
    return NextResponse.json({ status: 'degraded', db: 'down' }, { status: 503 })
  }
}
