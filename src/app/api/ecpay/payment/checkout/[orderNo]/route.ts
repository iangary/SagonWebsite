import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { shopConfig } from '@/lib/shop-config'
import { buildAioCheckoutParams, type ChoosePayment } from '@/lib/ecpay/aio'
import { ecpayEndpoints } from '@/lib/ecpay/config'
import { renderAutoSubmitForm } from '@/lib/ecpay/auto-submit'

export const dynamic = 'force-dynamic'

/**
 * 把使用者送去綠界收銀台。
 *
 * 刻意做成一支獨立的 GET 路由而不是在 Server Action 裡直接產表單，
 * 這樣使用者從綠界按上一頁再回來時可以重新產生一張有效的表單（簽章含時間戳）。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ orderNo: string }> }) {
  const { orderNo } = await params

  const order = await db.order.findUnique({
    where: { orderNo },
    include: { items: true, payment: true },
  })

  if (!order || !order.payment) {
    return NextResponse.json({ error: '找不到訂單' }, { status: 404 })
  }

  // 已付款的訂單不要再送一次去綠界，直接看結果頁
  if (order.status !== 'PENDING_PAYMENT') {
    return NextResponse.redirect(
      new URL(`/checkout/result?orderNo=${orderNo}`, env.APP_URL),
      303,
    )
  }

  const ecpayParams = buildAioCheckoutParams({
    merchantTradeNo: order.orderNo,
    totalAmount: order.grandTotal,
    tradeDesc: `${env.SHOP_NAME} 訂單 ${order.orderNo}`,
    items: order.items.map((item) => ({
      name: item.productName,
      qty: item.qty,
      unitPrice: item.unitPrice,
    })),
    choosePayment: order.payment.choosePayment as ChoosePayment,
    // 綠界的付款期限與我們的庫存保留時間對齊，避免「繳費成功但庫存已釋放」
    expireMinutes: shopConfig.stockReservationMinutes,
    customField1: order.id,
  })

  return renderAutoSubmitForm({
    action: ecpayEndpoints.aioCheckout,
    params: ecpayParams,
    title: '前往付款',
    message: '正在前往綠界安全付款頁面…',
  })
}
