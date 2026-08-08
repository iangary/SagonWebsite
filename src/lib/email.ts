import 'server-only'
import nodemailer from 'nodemailer'
import { env } from '@/lib/env'
import { db } from '@/lib/db'
import { formatTWD } from '@/lib/utils'
import { LOGISTICS_SUBTYPE_LABEL } from '@/lib/ecpay/logistics'

let transporter: nodemailer.Transporter | null = null

function getTransporter(): nodemailer.Transporter {
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    // 本機的 Mailpit 不需要帳密
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    // 逾時設短一點，讓 SMTP 連不上時快點失敗交給 BullMQ 重試，
    // 而不是把 worker 的 slot 卡住好幾分鐘。
    //
    // 注意：SMTP_HOST 請用 127.0.0.1 而不是 localhost。localhost 在 Windows 上
    // 會先解析成 ::1，Docker Desktop 的 IPv6 埠映射接受連線卻不轉發，
    // 結果就是等到逾時才報 "Greeting never received"。
    connectionTimeout: 10_000,
    greetingTimeout: 8_000,
    socketTimeout: 20_000,
  })
  return transporter
}

export type EmailTemplate = 'order-confirmed' | 'payment-info' | 'shipped' | 'order-cancelled'

/** 郵件內容不能用 Tailwind，只能用 inline style，這是共用的外框。 */
function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="zh-TW"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:24px;background:#faf8f5;font-family:'Microsoft JhengHei',system-ui,sans-serif;color:#2b2724;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e9e2d8;">
    <div style="padding:24px;border-bottom:1px solid #e9e2d8;text-align:center;">
      <span style="font-size:18px;letter-spacing:.2em;">${escapeHtml(env.SHOP_NAME)}</span>
    </div>
    <div style="padding:28px 24px;font-size:14px;line-height:1.9;">
      <h1 style="margin:0 0 20px;font-size:17px;font-weight:normal;letter-spacing:.08em;">${escapeHtml(title)}</h1>
      ${body}
    </div>
    <div style="padding:18px 24px;border-top:1px solid #e9e2d8;font-size:11px;color:#857263;text-align:center;">
      本信件由系統自動發送，請勿直接回覆。<br>
      客服信箱 service@sagon.local ｜ 統一編號 ${escapeHtml(env.SHOP_TAX_ID)}
    </div>
  </div>
</body></html>`
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function itemsTable(items: { productName: string; variantName: string; qty: number; lineTotal: number }[]) {
  const rows = items
    .map(
      (item) => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #f4f0ea;">
        ${escapeHtml(item.productName)}
        <div style="font-size:12px;color:#857263;">${escapeHtml(item.variantName)} × ${item.qty}</div>
      </td>
      <td style="padding:8px 0;border-bottom:1px solid #f4f0ea;text-align:right;white-space:nowrap;">
        ${formatTWD(item.lineTotal)}
      </td>
    </tr>`,
    )
    .join('')
  return `<table style="width:100%;border-collapse:collapse;font-size:13px;">${rows}</table>`
}

function summary(order: {
  subtotal: number
  discountTotal: number
  shippingFee: number
  grandTotal: number
}) {
  return `
  <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:12px;">
    <tr><td style="padding:3px 0;color:#4a423c;">小計</td><td style="text-align:right;">${formatTWD(order.subtotal)}</td></tr>
    ${order.discountTotal > 0 ? `<tr><td style="padding:3px 0;color:#4a423c;">折扣</td><td style="text-align:right;color:#b4524a;">-${formatTWD(order.discountTotal)}</td></tr>` : ''}
    <tr><td style="padding:3px 0;color:#4a423c;">運費</td><td style="text-align:right;">${order.shippingFee === 0 ? '免運費' : formatTWD(order.shippingFee)}</td></tr>
    <tr><td style="padding:10px 0 0;border-top:1px solid #e9e2d8;font-size:15px;">總計</td>
        <td style="padding:10px 0 0;border-top:1px solid #e9e2d8;text-align:right;font-size:15px;">${formatTWD(order.grandTotal)}</td></tr>
  </table>`
}

function orderLink(orderNo: string): string {
  const url = new URL(`/checkout/result?orderNo=${orderNo}`, env.APP_URL).toString()
  return `<p style="margin:24px 0 0;"><a href="${url}" style="display:inline-block;padding:11px 24px;background:#2b2724;color:#faf8f5;text-decoration:none;font-size:13px;letter-spacing:.05em;">查看訂單</a></p>`
}

/**
 * 寄出訂單相關通知信。
 * 內容全部即時從 DB 組出來，所以 worker 重試時寄到的一定是最新狀態。
 */
export async function sendOrderEmail(template: EmailTemplate, orderId: string): Promise<void> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { items: true, payment: true, shipment: true, invoice: true },
  })
  if (!order) throw new Error(`找不到訂單：${orderId}`)

  let subject: string
  let body: string

  switch (template) {
    case 'order-confirmed': {
      subject = `【${env.SHOP_NAME}】訂單 ${order.orderNo} 付款成功`
      body = `
        <p>${escapeHtml(order.recipientName)} 您好，我們已收到您的付款，訂單正在為您備貨中。</p>
        <p style="color:#857263;font-size:13px;">訂單編號：${order.orderNo}</p>
        ${itemsTable(order.items)}
        ${summary(order)}
        ${
          order.shipment
            ? `<p style="margin-top:20px;font-size:13px;color:#4a423c;">
                 配送方式：${LOGISTICS_SUBTYPE_LABEL[order.shipment.logisticsSubType]}<br>
                 ${
                   order.shipment.cvsStoreName
                     ? `取貨門市：${escapeHtml(order.shipment.cvsStoreName)}`
                     : `收件地址：${escapeHtml(order.shipment.receiverAddress ?? '')}`
                 }
               </p>`
            : ''
        }
        ${orderLink(order.orderNo)}`
      break
    }

    case 'payment-info': {
      const p = order.payment
      subject = `【${env.SHOP_NAME}】訂單 ${order.orderNo} 繳費資訊`
      body = `
        <p>${escapeHtml(order.recipientName)} 您好，您的訂單已成立，請於期限內完成付款。</p>
        <div style="margin:18px 0;padding:16px;background:#faf8f5;border:1px solid #e9e2d8;font-size:13px;">
          ${
            p?.vAccount
              ? `銀行代碼：<strong>${escapeHtml(p.bankCode ?? '')}</strong><br>
                 虛擬帳號：<strong>${escapeHtml(p.vAccount)}</strong><br>`
              : ''
          }
          ${p?.paymentNo ? `繳費代碼：<strong>${escapeHtml(p.paymentNo)}</strong><br>` : ''}
          金額：<strong>${formatTWD(order.grandTotal)}</strong><br>
          繳費期限：${escapeHtml(p?.expireDate ?? '—')}
        </div>
        <p style="font-size:13px;color:#857263;">逾期未付款的訂單將自動取消並釋放庫存。</p>
        ${orderLink(order.orderNo)}`
      break
    }

    case 'shipped': {
      subject = `【${env.SHOP_NAME}】訂單 ${order.orderNo} 已出貨`
      body = `
        <p>${escapeHtml(order.recipientName)} 您好，您的訂單已出貨。</p>
        <div style="margin:18px 0;padding:16px;background:#faf8f5;border:1px solid #e9e2d8;font-size:13px;">
          配送方式：${order.shipment ? LOGISTICS_SUBTYPE_LABEL[order.shipment.logisticsSubType] : '—'}<br>
          ${order.shipment?.shipmentNo ? `貨態單號：<strong>${escapeHtml(order.shipment.shipmentNo)}</strong><br>` : ''}
          ${order.shipment?.cvsStoreName ? `取貨門市：${escapeHtml(order.shipment.cvsStoreName)}` : ''}
        </div>
        <p style="font-size:13px;color:#857263;">超商取貨請於到店通知後 7 日內完成取貨。</p>
        ${orderLink(order.orderNo)}`
      break
    }

    case 'order-cancelled': {
      subject = `【${env.SHOP_NAME}】訂單 ${order.orderNo} 已取消`
      body = `
        <p>${escapeHtml(order.recipientName)} 您好，您的訂單因逾期未完成付款已自動取消，庫存已釋放。</p>
        <p style="color:#857263;font-size:13px;">訂單編號：${order.orderNo}</p>
        <p>若仍想購買，歡迎重新下單。</p>`
      break
    }
  }

  await getTransporter().sendMail({
    from: env.MAIL_FROM,
    to: order.email,
    subject,
    html: layout(subject.replace(/^【[^】]*】/, ''), body),
  })
}
