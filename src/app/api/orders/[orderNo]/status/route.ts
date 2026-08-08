import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * 結果頁輪詢用。只回傳狀態列舉，不含任何個資，
 * 所以不需要驗證身分（訂單編號本身是隨機碼，猜不到）。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ orderNo: string }> }) {
  const { orderNo } = await params

  const order = await db.order.findUnique({
    where: { orderNo },
    select: { status: true, payment: { select: { status: true } } },
  })

  if (!order) return NextResponse.json({ error: 'not found' }, { status: 404 })

  return NextResponse.json(
    { status: order.status, paymentStatus: order.payment?.status ?? null },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
