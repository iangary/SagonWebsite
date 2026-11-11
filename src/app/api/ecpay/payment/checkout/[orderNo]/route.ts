import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { getPaymentSettings, holdMinutesFor, type PaymentChoice } from '@/lib/shop-settings'
import { claimCheckoutPayment } from '@/lib/orders/payment-method'
import { buildAioCheckoutParams, type ChoosePayment } from '@/lib/ecpay/aio'
import { ecpayEndpoints } from '@/lib/ecpay/config'
import { renderAutoSubmitForm } from '@/lib/ecpay/auto-submit'

export const dynamic = 'force-dynamic'

/**
 * 把使用者送去綠界收銀台。
 *
 * 刻意做成一支獨立的 GET 路由而不是在 Server Action 裡直接產表單，
 * 這樣使用者從綠界按上一頁再回來時可以重新產生一張有效的表單（簽章含時間戳）。
 * 綠界不收重複的 MerchantTradeNo，送過的那組會換新的再送（見 claimCheckoutPayment）。
 */
export async function GET(_req: Request, { params }: { params: Promise<{ orderNo: string }> }) {
  const { orderNo } = await params

  const claim = await claimCheckoutPayment(orderNo)

  if (claim.kind === 'not-found') {
    return NextResponse.json({ error: '找不到訂單' }, { status: 404 })
  }

  // 已付款／已取消、貨到付款、匯款，或 ATM／超商已經取號（代碼印在結果頁上）：都不必再去綠界
  if (claim.kind !== 'send') {
    return NextResponse.redirect(
      new URL(`/checkout/result?orderNo=${orderNo}`, env.APP_URL),
      303,
    )
  }

  const { payment, order } = claim
  const items = await db.orderItem.findMany({
    where: { orderId: order.id },
    select: { productName: true, qty: true, unitPrice: true },
  })

  const settings = await getPaymentSettings()

  const ecpayParams = buildAioCheckoutParams({
    // 一定要用 payment 自己的單號，不能用 order.orderNo ——
    // 改過付款方式、或之前送過收銀台的話，生效的那筆已經是另一組 MerchantTradeNo。
    merchantTradeNo: payment.merchantTradeNo,
    totalAmount: order.grandTotal,
    tradeDesc: `${env.SHOP_NAME} 訂單 ${order.orderNo}`,
    items: items.map((item) => ({
      name: item.productName,
      qty: item.qty,
      unitPrice: item.unitPrice,
    })),
    choosePayment: payment.choosePayment as ChoosePayment,
    // 綠界的付款期限與我們的庫存保留時間對齊，避免「繳費成功但庫存已釋放」
    expireMinutes: holdMinutesFor(payment.choosePayment as PaymentChoice, settings),
    customField1: order.id,
  })

  return renderAutoSubmitForm({
    action: ecpayEndpoints.aioCheckout,
    params: ecpayParams,
    title: '前往付款',
    message: '正在前往綠界安全付款頁面…',
  })
}
