import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'

/**
 * 只供本機開發與自動化測試使用：讓 scripts/simulate-ecpay-callback.ts
 * 取得訂單金額，才能組出金額正確的模擬通知。
 * 正式環境直接回 404，避免變成對外洩漏訂單金額的管道。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ orderNo: string }> }) {
  if (env.NODE_ENV === 'production' || env.ECPAY_ENV === 'production') {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const { orderNo } = await params
  const order = await db.order.findUnique({
    where: { orderNo },
    select: { grandTotal: true, status: true },
  })

  if (!order) return NextResponse.json({ error: 'not found' }, { status: 404 })

  return NextResponse.json(order, { headers: { 'Cache-Control': 'no-store' } })
}
