import { NextResponse } from 'next/server'
import { currentUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { readLabel } from '@/lib/tcat/labels'

export const dynamic = 'force-dynamic'

/**
 * 黑貓託運單 PDF。
 *
 * 託運單上有收件人的姓名、地址、電話，所以檔案存在 storage/ 而不是 public/，
 * 一定要經過這支路由才讀得到。proxy.ts 只擋 /admin，API 路徑不在它的 matcher 裡，
 * 這裡必須自己驗身分 —— 與 /api/chat/admin 的做法一致。
 */
export async function GET(_request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const user = await currentUser()
  if (!user || user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { orderId } = await params

  const shipment = await db.shipment.findUnique({
    where: { orderId },
    select: { labelPath: true, order: { select: { orderNo: true } } },
  })

  if (!shipment?.labelPath) {
    return NextResponse.json({ error: '這張訂單還沒有託運單檔案' }, { status: 404 })
  }

  const pdf = await readLabel(shipment.labelPath)
  if (!pdf) {
    // 資料庫有記錄但檔案不在 —— 多半是 storage/ 沒掛 volume 就重建了容器
    return NextResponse.json(
      { error: '託運單檔案不存在，可能已被清除。黑貓的下載連結只有 24 小時，逾期需重新建單。' },
      { status: 404 },
    )
  }

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      // inline 讓瀏覽器直接開預覽，方便按 Ctrl+P 列印
      'Content-Disposition': `inline; filename="${shipment.order.orderNo}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
