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
} from '@/lib/orders/labels'
import { Badge, ORDER_STATUS_TONE } from '@/components/ui/badge'
import { DataTable, Td } from '@/components/admin/ui'
import { OrderActions } from './order-actions'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const order = await db.order.findUnique({ where: { id }, select: { orderNo: true } })
  return { title: order ? `訂單 ${order.orderNo}` : '訂單' }
}

export default async function AdminOrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const order = await db.order.findUnique({
    where: { id },
    include: {
      items: true,
      payment: true,
      invoice: true,
      receipt: true,
      coupon: true,
      user: { select: { id: true, name: true, email: true } },
      shipment: { include: { logs: { orderBy: { occurredAt: 'desc' } } } },
    },
  })

  if (!order) notFound()

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
                value={CHOOSE_PAYMENT_LABEL[order.payment?.choosePayment ?? ''] ?? '—'}
              />
              <Row
                label="狀態"
                value={order.payment ? PAYMENT_STATUS_LABEL[order.payment.status] : '—'}
              />
              {order.payment?.tradeNo && <Row label="綠界交易編號" value={order.payment.tradeNo} />}
              {order.payment?.vAccount && (
                <>
                  <Row label="銀行代碼" value={order.payment.bankCode ?? '—'} />
                  <Row label="虛擬帳號" value={order.payment.vAccount} />
                </>
              )}
              {order.payment?.paymentNo && (
                <Row label="繳費代碼" value={order.payment.paymentNo} />
              )}
              {order.payment?.failReason && (
                <Row label="失敗原因" value={order.payment.failReason} tone="sale" />
              )}
            </dl>
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
