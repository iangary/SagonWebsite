import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { db } from '@/lib/db'
import { formatTWD } from '@/lib/utils'
import { LOGISTICS_SUBTYPE_LABEL, buildPrintDocumentParams, isC2C } from '@/lib/ecpay/logistics'
import {
  ORDER_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  SHIPMENT_STATUS_LABEL,
  INVOICE_STATUS_LABEL,
  RECEIPT_STATUS_LABEL,
  CHOOSE_PAYMENT_LABEL,
  REFUND_METHOD_LABEL,
  REFUND_STATUS_LABEL,
} from '@/lib/orders/labels'
import { currentPaymentOf } from '@/lib/orders/payment'
import { refundEligibility } from '@/lib/orders/refund'
import { getPaymentSettings } from '@/lib/shop-settings'
import { Badge, ORDER_STATUS_TONE } from '@/components/ui/badge'
import { DataTable, Td } from '@/components/admin/ui'
import { OrderActions } from './order-actions'
import { RefundOpener } from './refund-opener'

/** 不能開退款單時，把原因直接寫在區塊裡，免得客服對著空白區塊猜 */
const REFUND_BLOCKED_NOTE: Record<string, string> = {
  notPaid: '這張訂單還沒有收到款項，沒有東西可以退（未付款的訂單請直接取消）',
  alreadyRequested: '已經有一筆退款單在處理中，請到退款頁繼續。',
  cancelled: '訂單已取消，沒有款項需要退還。',
  refunded: '這張訂單已經退款完成。',
  none: '目前無法建立退款單。',
}

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const order = await db.order.findUnique({ where: { id }, select: { orderNo: true } })
  return { title: order ? `訂單 ${order.orderNo}` : '訂單' }
}

export default async function AdminOrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const [settings, order] = await Promise.all([
    getPaymentSettings(),
    db.order.findUnique({
      where: { id },
      include: {
        items: true,
        payments: { orderBy: { createdAt: 'desc' } },
        refunds: { orderBy: { createdAt: 'desc' } },
        invoice: true,
        receipt: true,
        coupon: true,
        user: { select: { id: true, name: true, email: true } },
        shipment: { include: { logs: { orderBy: { occurredAt: 'desc' } } } },
      },
    }),
  ])

  if (!order) notFound()

  // 目前生效的付款。改過付款方式的訂單會有多筆，舊的留著比對逾期入帳。
  const payment = currentPaymentOf(order.payments)
  const supersededPayments = order.payments.filter((p) => p.id !== payment?.id)

  // 匯款是人工入帳，對帳備註（末五碼、入帳日）存在 rawCallback 裡，
  // 不能放 failReason —— 那格在畫面上是紅字的「失敗原因」。
  const bankPaidNote =
    payment?.provider === 'BANK' && payment.rawCallback && typeof payment.rawCallback === 'object'
      ? String((payment.rawCallback as Record<string, unknown>).note ?? '')
      : ''

  // 能不能開退款單。超過期限時仍顯示表單，但要客服明確勾選才建得起來。
  // 刻意不叫 refund —— 下面列出既有退款單的 map 也用這個名字。
  const refundability = refundEligibility(order, settings)

  // 列印一段標要 POST 到綠界，在伺服器端先把帶簽章的參數算好交給前端。
  // 只有超商取貨走綠界；宅配是黑貓，託運單 PDF 走 /api/admin/labels/[orderId]。
  const printForm =
    order.shipment?.allPayLogisticsId && isC2C(order.shipment.logisticsSubType)
      ? buildPrintDocumentParams(
          order.shipment.logisticsSubType,
          order.shipment.allPayLogisticsId,
          order.shipment.shipmentNo ?? undefined,
          order.shipment.cvsValidationNo ?? undefined,
        )
      : null

  return (
    <>
      <Link
        href="/admin/orders"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-taupe-600 hover:text-ink-900"
      >
        <ArrowLeft size={14} />
        回訂單列表
      </Link>

      <header className="mb-8 flex flex-wrap items-start justify-between gap-4 border-b border-cream-200 pb-5">
        <div>
          <h1 className="text-xl tabular-nums tracking-[0.08em]">{order.orderNo}</h1>
          <p className="mt-1.5 text-sm text-taupe-600">
            成立於 {order.createdAt.toLocaleString('zh-TW', { hour12: false })}
            {order.paidAt && ` ・ 付款於 ${order.paidAt.toLocaleString('zh-TW', { hour12: false })}`}
          </p>
        </div>
        <Badge tone={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS_LABEL[order.status]}</Badge>
      </header>

      <OrderActions
        orderId={order.id}
        orderStatus={order.status}
        shippingMethod={order.shippingMethod}
        // 黑貓建單成功不會回 allPayLogisticsId，只看它會讓按鈕一直可按、重複建單
        hasShipment={Boolean(order.shipment?.shipmentNo || order.shipment?.allPayLogisticsId)}
        hasLabel={Boolean(order.shipment?.labelPath)}
        // 建單曾轉人工處理（例如黑貓逾時，單可能已成立）：再按建單前必須先確認，
        // 否則會產生第二張真實託運單
        manualNote={
          order.shipment?.status === 'PENDING' &&
          !order.shipment.shipmentNo &&
          !order.shipment.allPayLogisticsId
            ? (order.shipment.statusMsg ?? null)
            : null
        }
        invoiceStatus={order.invoice?.status ?? null}
        receiptStatus={order.receipt?.status ?? null}
        printForm={printForm}
        // 「客戶到底付款了沒」：綠界金流用 QueryTradeInfo 查，貨到付款則是手動標記
        paymentProvider={payment?.provider ?? null}
        paymentStatus={payment?.status ?? null}
      />

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title="訂單品項">
            <DataTable headers={['商品', '規格', 'SKU', '單價', '數量', '小計']}>
              {order.items.map((item) => (
                <tr key={item.id}>
                  <Td>{item.productName}</Td>
                  <Td className="text-taupe-600">{item.variantName}</Td>
                  <Td className="font-mono text-xs text-taupe-500">{item.sku}</Td>
                  <Td className="tabular-nums">{formatTWD(item.unitPrice)}</Td>
                  <Td className="tabular-nums">{item.qty}</Td>
                  <Td className="tabular-nums">{formatTWD(item.lineTotal)}</Td>
                </tr>
              ))}
            </DataTable>

            <dl className="mt-4 ml-auto max-w-xs space-y-1.5 text-sm">
              <Row label="小計" value={formatTWD(order.subtotal)} />
              {order.discountTotal > 0 && (
                <Row
                  label={`折扣${order.coupon ? `（${order.coupon.code}）` : ''}`}
                  value={`-${formatTWD(order.discountTotal)}`}
                />
              )}
              <Row
                label="運費"
                value={order.shippingFee === 0 ? '免運費' : formatTWD(order.shippingFee)}
              />
              {order.codFee > 0 && (
                <Row label="貨到付款手續費" value={formatTWD(order.codFee)} />
              )}
              <div className="flex justify-between border-t border-cream-200 pt-2 text-base">
                <dt>總計</dt>
                <dd className="tabular-nums">{formatTWD(order.grandTotal)}</dd>
              </div>
            </dl>
          </Section>

          {order.shipment && order.shipment.logs.length > 0 && (
            <Section title="物流軌跡">
              <ol className="space-y-3">
                {order.shipment.logs.map((log) => (
                  <li key={log.id} className="flex gap-3 text-sm">
                    <time className="shrink-0 tabular-nums text-xs text-taupe-500">
                      {log.occurredAt.toLocaleString('zh-TW', { hour12: false })}
                    </time>
                    <span className="text-ink-700">
                      <span className="mr-2 font-mono text-xs text-taupe-500">{log.statusCode}</span>
                      {log.message}
                    </span>
                  </li>
                ))}
              </ol>
            </Section>
          )}
        </div>

        <div className="space-y-6">
          <Section title="收件資訊">
            <dl className="space-y-2 text-sm">
              <Row label="收件人" value={order.recipientName} />
              <Row label="手機" value={order.recipientPhone} />
              <Row label="Email" value={order.email} />
              {order.user && (
                <Row label="會員" value={order.user.name ?? order.user.email ?? order.user.id} />
              )}
              {order.note && <Row label="備註" value={order.note} />}
            </dl>
          </Section>

          <Section title="付款">
            <dl className="space-y-2 text-sm">
              <Row
                label="方式"
                value={CHOOSE_PAYMENT_LABEL[payment?.choosePayment ?? ''] ?? '—'}
              />
              <Row label="狀態" value={payment ? PAYMENT_STATUS_LABEL[payment.status] : '—'} />
              {payment?.paidAt && (
                <Row
                  label="收款時間"
                  value={payment.paidAt.toLocaleString('zh-TW', { hour12: false })}
                />
              )}
              {payment?.expireDate && (
                <Row
                  label={payment.provider === 'BANK' ? '匯款期限' : '繳費期限'}
                  value={payment.expireDate}
                />
              )}
              {payment?.tradeNo && <Row label="綠界交易編號" value={payment.tradeNo} />}
              {payment?.merchantTradeNo && (
                <Row label="金流單號" value={payment.merchantTradeNo} />
              )}
              {payment?.vAccount && (
                <>
                  <Row label="銀行代碼" value={payment.bankCode ?? '—'} />
                  <Row label="虛擬帳號" value={payment.vAccount} />
                </>
              )}
              {payment?.paymentNo && <Row label="繳費代碼" value={payment.paymentNo} />}
              {payment?.barcode1 && (
                <Row
                  label="繳費條碼"
                  value={[payment.barcode1, payment.barcode2, payment.barcode3]
                    .filter(Boolean)
                    .join(' / ')}
                />
              )}
              {payment?.syncedAt && (
                <Row
                  label="最後對帳"
                  value={payment.syncedAt.toLocaleString('zh-TW', { hour12: false })}
                />
              )}
              {bankPaidNote && <Row label="入帳備註" value={bankPaidNote} />}
              {payment?.failReason && (
                <Row label="失敗原因" value={payment.failReason} tone="sale" />
              )}
            </dl>

            {/* 已作廢的付款紀錄：消費者改過付款方式時留下的。
                一定要顯示 —— 舊的超商代碼在期限內仍然繳得成功，
                客服要看得出「這張訂單還有另一組代碼在外面」。 */}
            {supersededPayments.length > 0 && (
              <div className="mt-4 border-t border-cream-200 pt-3">
                <p className="mb-2 text-xs text-taupe-500">已作廢的付款紀錄</p>
                <ul className="space-y-1.5 text-xs text-taupe-600">
                  {supersededPayments.map((p) => (
                    <li key={p.id} className="flex justify-between gap-3">
                      <span>
                        {CHOOSE_PAYMENT_LABEL[p.choosePayment] ?? p.choosePayment}
                        {p.paymentNo && ` ・ ${p.paymentNo}`}
                        {p.vAccount && ` ・ ${p.vAccount}`}
                      </span>
                      <span className="shrink-0">{PAYMENT_STATUS_LABEL[p.status]}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>

          <Section title="退款">
            {order.refunds.length > 0 && (
              <ul className="mb-4 space-y-3 text-sm">
                {order.refunds.map((refund) => (
                  <li key={refund.id} className="border-b border-cream-200 pb-3 last:border-0 last:pb-0">
                    <div className="flex justify-between gap-3">
                      <span>{formatTWD(refund.amount)}</span>
                      <span
                        className={
                          refund.status === 'REQUESTED' || refund.status === 'FAILED'
                            ? 'text-sale'
                            : 'text-ink-700'
                        }
                      >
                        {REFUND_STATUS_LABEL[refund.status]}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-taupe-600">{refund.reason}</p>
                    <p className="mt-1 text-xs text-taupe-500">
                      {refund.method ? REFUND_METHOD_LABEL[refund.method] : '方式未定'} ・{' '}
                      {refund.createdAt.toLocaleString('zh-TW', { hour12: false })}
                    </p>
                    {refund.bankAccountNo && (
                      <p className="mt-1 text-xs text-ink-700">
                        匯款帳戶：{refund.bankCode} / {refund.bankAccountNo}（{refund.accountName}）
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {/* 客人是在 LINE 上談退款的（前台沒有申請表單），所以由客服在這裡開單。
                已經有一筆在處理時不給再開 —— refundEligibility 會擋掉。 */}
            {refundability.eligible || refundability.reasonKey === 'windowClosed' ? (
              <RefundOpener
                orderId={order.id}
                needsBankAccount={refundability.needsBankAccount}
                windowClosed={refundability.reasonKey === 'windowClosed'}
              />
            ) : (
              <p className="text-sm text-taupe-500">
                {REFUND_BLOCKED_NOTE[refundability.reasonKey ?? 'none']}
              </p>
            )}

            {order.refunds.length > 0 && (
              <Link
                href="/admin/refunds"
                className="mt-3 inline-block text-xs text-ink-900 underline underline-offset-4"
              >
                到退款頁處理
              </Link>
            )}
          </Section>

          <Section title="物流">
            {order.shipment ? (
              <dl className="space-y-2 text-sm">
                <Row
                  label="方式"
                  value={LOGISTICS_SUBTYPE_LABEL[order.shipment.logisticsSubType]}
                />
                <Row label="狀態" value={SHIPMENT_STATUS_LABEL[order.shipment.status]} />
                {order.shipment.cvsStoreName && (
                  <>
                    <Row label="取貨門市" value={order.shipment.cvsStoreName} />
                    <Row label="門市代號" value={order.shipment.cvsStoreId ?? '—'} />
                    <Row label="門市地址" value={order.shipment.cvsAddress ?? '—'} />
                  </>
                )}
                {order.shipment.receiverAddress && (
                  <Row label="收件地址" value={order.shipment.receiverAddress} />
                )}
                {order.shipment.allPayLogisticsId && (
                  <Row label="綠界物流編號" value={order.shipment.allPayLogisticsId} />
                )}
                {order.shipment.shipmentNo && (
                  <Row label="貨態單號" value={order.shipment.shipmentNo} />
                )}
                {order.shipment.failReason && (
                  <Row label="建單失敗" value={order.shipment.failReason} tone="sale" />
                )}
                {order.shipment.statusMsg && (
                  // manual fallback 的人工處理指示也寫在 statusMsg，一定要讓客服看得到
                  <Row
                    label="狀態訊息"
                    value={order.shipment.statusMsg}
                    tone={order.shipment.status === 'PENDING' ? 'sale' : undefined}
                  />
                )}
              </dl>
            ) : (
              <p className="text-sm text-taupe-500">無物流資料</p>
            )}
          </Section>

          <Section title="發票（紙本，人工開立）">
            {order.invoice ? (
              <dl className="space-y-2 text-sm">
                <Row label="狀態" value={INVOICE_STATUS_LABEL[order.invoice.status]} />
                <Row label="開立對象" value={order.invoice.isB2B ? '公司' : '個人'} />
                {order.invoice.taxId && <Row label="統一編號" value={order.invoice.taxId} />}
                {order.invoice.companyName && (
                  <Row label="公司抬頭" value={order.invoice.companyName} />
                )}
                {order.invoice.invoiceNumber && (
                  <Row label="發票號碼" value={order.invoice.invoiceNumber} />
                )}
                {order.invoice.invoiceDate && (
                  <Row
                    label="開立日期"
                    value={order.invoice.invoiceDate.toLocaleDateString('zh-TW')}
                  />
                )}
                {order.invoice.voidReason && (
                  <Row label="作廢原因" value={order.invoice.voidReason} tone="sale" />
                )}
              </dl>
            ) : (
              <p className="text-sm text-taupe-500">無發票資料</p>
            )}
          </Section>

          <Section title="電子收據（綠界）">
            {order.receipt ? (
              <dl className="space-y-2 text-sm">
                <Row label="狀態" value={RECEIPT_STATUS_LABEL[order.receipt.status]} />
                {order.receipt.receiptNo && (
                  <Row label="收據編號" value={order.receipt.receiptNo} />
                )}
                {order.receipt.issuedAt && (
                  <Row
                    label="開立時間"
                    value={order.receipt.issuedAt.toLocaleString('zh-TW', { hour12: false })}
                  />
                )}
                {order.receipt.failReason && (
                  <Row label="失敗原因" value={order.receipt.failReason} tone="sale" />
                )}
              </dl>
            ) : (
              <p className="text-sm text-taupe-500">無收據資料</p>
            )}
          </Section>
        </div>
      </div>
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-cream-200 bg-white p-5">
      <h2 className="mb-4 text-sm tracking-[0.1em] text-ink-900">{title}</h2>
      {children}
    </section>
  )
}

function Row({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'sale'
}) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="shrink-0 text-taupe-600">{label}</dt>
      <dd className={`break-all text-right ${tone === 'sale' ? 'text-sale' : 'text-ink-900'}`}>
        {value}
      </dd>
    </div>
  )
}
