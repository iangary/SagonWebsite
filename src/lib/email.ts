import 'server-only'
import nodemailer, { type Mail } from 'nodemailer'
import { env } from '@/lib/env'
import { db } from '@/lib/db'
import { formatTWD } from '@/lib/utils'
import { LOGISTICS_SUBTYPE_LABEL } from '@/lib/ecpay/logistics'
import { currentPaymentOf } from '@/lib/orders/payment'
import { bankAccountOf } from '@/lib/orders/bank-transfer'
import { reviewPageUrl } from '@/lib/orders/review-invite'
import { getPaymentSettings } from '@/lib/shop-settings'

let transporter: Mail | null = null

function getTransporter(): Mail {
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

export type EmailTemplate =
  | 'order-confirmed'
  | 'payment-info'
  | 'bank-transfer-info'
  | 'shipped'
  | 'order-cancelled'
  | 'cod-confirmed'
  | 'refund-requested'
  | 'refund-approved'
  | 'refund-rejected'
  | 'refund-completed'
  | 'review-invite'

/** 退款相關的信要嘛寄給客服、要嘛寄給消費者，收件人不同 */
const TO_SERVICE: ReadonlySet<EmailTemplate> = new Set(['refund-requested'])

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
      客服信箱 ${escapeHtml(env.SHOP_SERVICE_EMAIL)} ｜ 統一編號 ${escapeHtml(env.SHOP_TAX_ID)}
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
 * Email 註冊後的一次性驗證信。
 *
 * 和訂單通知信無關（沒有 orderId，也不進 BullMQ），所以不放進 EmailTemplate ——
 * 但共用同一個 transporter 與外框，改版型時兩邊一起變。
 */
export async function sendEmailVerification(
  to: string,
  verifyUrl: string,
  /** 有效時數。常數住在 email-verification.ts，用參數傳進來避免兩個模組互相 import。 */
  expiresInHours: number,
): Promise<void> {
  const subject = `【${env.SHOP_NAME}】請驗證您的電子信箱`
  const body = `
    <p>您好，感謝您註冊 ${escapeHtml(env.SHOP_NAME)} 會員。</p>
    <p>請點擊下方按鈕完成信箱驗證，之後登入只需要 Email 與密碼，不會再收到驗證信。</p>
    <p style="margin:24px 0 0;"><a href="${escapeHtml(verifyUrl)}" style="display:inline-block;padding:11px 24px;background:#2b2724;color:#faf8f5;text-decoration:none;font-size:13px;letter-spacing:.05em;">驗證我的信箱</a></p>
    <p style="margin:18px 0 0;font-size:12px;color:#857263;">
      按鈕無法點擊時，請複製以下連結貼到瀏覽器：<br>
      <span style="word-break:break-all;">${escapeHtml(verifyUrl)}</span>
    </p>
    <p style="margin:18px 0 0;font-size:12px;color:#857263;">
      連結 ${expiresInHours} 小時內有效。若這不是您本人的操作，請忽略這封信，您的帳號不會有任何變動。
    </p>`

  await getTransporter().sendMail({
    from: env.MAIL_FROM,
    to,
    subject,
    html: layout('驗證您的電子信箱', body),
  })
}

/**
 * 寄出訂單相關通知信。
 * 內容全部即時從 DB 組出來，所以 worker 重試時寄到的一定是最新狀態。
 */
export async function sendOrderEmail(
  template: EmailTemplate,
  orderId: string,
  options: { refundId?: string } = {},
): Promise<void> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      payments: { orderBy: { createdAt: 'desc' } },
      shipment: true,
      invoice: true,
    },
  })
  if (!order) throw new Error(`找不到訂單：${orderId}`)

  const payment = currentPaymentOf(order.payments)
  const refund = options.refundId
    ? await db.refundRequest.findUnique({ where: { id: options.refundId } })
    : null

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
      const p = payment
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

    /**
     * 匯款到公司帳戶的帳號與期限。
     *
     * 這封信比其他通知信重要 —— 客人關掉訂單頁就找不到帳號了。
     * 帳戶從設定即時讀出（只有一組公司帳戶），worker 重試時寄到的一定是現行帳號。
     */
    case 'bank-transfer-info': {
      const bank = bankAccountOf(await getPaymentSettings())
      subject = `【${env.SHOP_NAME}】訂單 ${order.orderNo} 匯款資訊`
      body = `
        <p>${escapeHtml(order.recipientName)} 您好，您的訂單已成立，請於期限內完成匯款。</p>
        <div style="margin:18px 0;padding:16px;background:#faf8f5;border:1px solid #e9e2d8;font-size:13px;">
          銀行：${escapeHtml(bank.bankName)}<br>
          銀行代號：<strong>${escapeHtml(bank.bankCode)}</strong><br>
          帳號：<strong>${escapeHtml(bank.accountNo)}</strong><br>
          戶名：${escapeHtml(bank.accountName)}<br>
          金額：<strong>${formatTWD(order.grandTotal)}</strong><br>
          匯款期限：${escapeHtml(payment?.expireDate ?? '—')}
        </div>
        ${bank.note ? `<p style="font-size:13px;">${escapeHtml(bank.note)}</p>` : ''}
        <p style="font-size:13px;color:#857263;">
          匯款需人工核對，我們確認入帳後會再寄一封付款成功的通知信給您（通常一個工作日內）。
          逾期未匯款的訂單將自動取消並釋放庫存。
        </p>
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

    case 'cod-confirmed': {
      subject = `【${env.SHOP_NAME}】訂單 ${order.orderNo} 已成立（貨到付款）`
      body = `
        <p>${escapeHtml(order.recipientName)} 您好，您的訂單已成立，我們正在為您備貨。</p>
        <p style="color:#857263;font-size:13px;">訂單編號：${order.orderNo}</p>
        ${itemsTable(order.items)}
        ${summary(order)}
        <div style="margin:18px 0;padding:16px;background:#faf8f5;border:1px solid #e9e2d8;font-size:13px;">
          付款方式：<strong>貨到付款</strong><br>
          應付金額：<strong>${formatTWD(order.grandTotal)}</strong><br>
          ${
            order.shipment?.cvsStoreName
              ? `取貨門市：${escapeHtml(order.shipment.cvsStoreName)}<br>請於取貨時在櫃檯付款。`
              : '請於收到包裹時將款項交給配送人員。'
          }
        </div>
        ${orderLink(order.orderNo)}`
      break
    }

    case 'refund-requested': {
      // 這封是寄給客服的內部通知，附上人工匯款要用的帳戶資訊
      subject = `【${env.SHOP_NAME}】訂單 ${order.orderNo} 有新的退款申請`
      body = `
        <p>訂單 ${order.orderNo} 的消費者提出退款申請，請至後台處理。</p>
        <div style="margin:18px 0;padding:16px;background:#faf8f5;border:1px solid #e9e2d8;font-size:13px;">
          金額：<strong>${formatTWD(refund?.amount ?? order.grandTotal)}</strong><br>
          原付款方式：${escapeHtml(payment?.choosePayment ?? '—')}<br>
          退款方式：${refund?.method === 'CREDIT_REVERSE' ? '信用卡退刷' : '人工匯款'}<br>
          ${
            refund?.bankAccountNo
              ? `收款帳戶：${escapeHtml(refund.bankCode ?? '')} / ${escapeHtml(refund.bankAccountNo)}（${escapeHtml(refund.accountName ?? '')}）<br>`
              : ''
          }
          申請原因：${escapeHtml(refund?.reason ?? '')}
        </div>
        <p style="margin:24px 0 0;"><a href="${new URL('/admin/refunds', env.APP_URL).toString()}" style="display:inline-block;padding:11px 24px;background:#2b2724;color:#faf8f5;text-decoration:none;font-size:13px;letter-spacing:.05em;">前往後台</a></p>`
      break
    }

    case 'refund-approved': {
      subject = `【${env.SHOP_NAME}】訂單 ${order.orderNo} 退款申請已受理`
      body = `
        <p>${escapeHtml(order.recipientName)} 您好，您的退款申請已受理。</p>
        <div style="margin:18px 0;padding:16px;background:#faf8f5;border:1px solid #e9e2d8;font-size:13px;">
          訂單編號：${order.orderNo}<br>
          退款金額：<strong>${formatTWD(refund?.amount ?? order.grandTotal)}</strong><br>
          退款方式：${refund?.method === 'CREDIT_REVERSE' ? '刷退至原信用卡' : '匯款至您提供的帳戶'}
        </div>
        <p style="font-size:13px;color:#857263;">
          ${
            refund?.method === 'CREDIT_REVERSE'
              ? '刷退作業依發卡銀行作業時間，通常會在下一期帳單或數個工作日內顯示。'
              : '我們會在 3 個工作日內完成匯款，完成後另行通知。若尚未提供收款帳戶，請在 LINE 上告知客服。'
          }
        </p>`
      break
    }

    case 'refund-rejected': {
      subject = `【${env.SHOP_NAME}】訂單 ${order.orderNo} 退款申請結果`
      body = `
        <p>${escapeHtml(order.recipientName)} 您好，關於您訂單 ${order.orderNo} 的退款申請，我們目前無法受理。</p>
        ${
          refund?.adminNote
            ? `<div style="margin:18px 0;padding:16px;background:#faf8f5;border:1px solid #e9e2d8;font-size:13px;">說明：${escapeHtml(refund.adminNote)}</div>`
            : ''
        }
        <p style="font-size:13px;color:#857263;">若有疑問，歡迎在 LINE 上直接回覆客服，或來信 ${escapeHtml(env.SHOP_SERVICE_EMAIL)}。</p>`
      break
    }

    case 'refund-completed': {
      subject = `【${env.SHOP_NAME}】訂單 ${order.orderNo} 退款已完成`
      body = `
        <p>${escapeHtml(order.recipientName)} 您好，您的退款已處理完成。</p>
        <div style="margin:18px 0;padding:16px;background:#faf8f5;border:1px solid #e9e2d8;font-size:13px;">
          訂單編號：${order.orderNo}<br>
          退款金額：<strong>${formatTWD(refund?.amount ?? order.grandTotal)}</strong><br>
          退款方式：${refund?.method === 'CREDIT_REVERSE' ? '刷退至原信用卡' : '匯款'}
        </div>
        <p style="font-size:13px;color:#857263;">感謝您的耐心等候。</p>`
      break
    }

    /*
     * 評論邀請信。
     *
     * 文案上刻意寫「不論好壞都想知道」，而且不綁任何折扣或贈品 ——
     * 用對價換取評價違反平台政策，也踩到公平會〈薦證廣告處理原則〉；
     * 只徵求好評同樣是不實廣告的風險。明講歡迎負評才是安全的做法，
     * 而且回覆率反而更高。
     *
     * 另外給一個「直接回信」的出口，把本來會變成公開負評的不滿先接到私下處理。
     */
    case 'review-invite': {
      const firstItem = order.items[0]
      // 商品名稱是從來源站帶進來的，中間常有連續空白，主旨裡看起來很髒
      const firstName = firstItem?.productName.replace(/\s+/g, ' ').trim()
      const itemSummary = firstName
        ? `${firstName}${order.items.length > 1 ? ` 等 ${order.items.length} 件商品` : ''}`
        : '您購買的商品'

      subject = `【${env.SHOP_NAME}】${itemSummary}用起來還習慣嗎？`
      body = `
        <p>${escapeHtml(order.recipientName)} 您好，</p>
        <p>您在 ${order.completedAt ? order.completedAt.toLocaleDateString('zh-TW') : ''} 完成的訂單已經送達一段時間了，${escapeHtml(itemSummary)}用起來還習慣嗎？</p>
        <p>如果方便的話，想請您花一分鐘留下使用心得 ——
           <strong>不論好壞我們都想知道</strong>，這會直接影響我們接下來挑什麼、不挑什麼。</p>
        ${itemsTable(order.items)}
        <p style="margin:24px 0 0;">
          <a href="${reviewPageUrl(order.id)}" style="display:inline-block;padding:11px 24px;background:#2b2724;color:#faf8f5;text-decoration:none;font-size:13px;letter-spacing:.05em;">留下評價</a>
        </p>
        <p style="font-size:13px;color:#857263;margin-top:20px;">
          如果有任何不合適的地方，歡迎來信客服信箱
          <a href="mailto:${escapeHtml(env.SHOP_SERVICE_EMAIL)}" style="color:#857263;">${escapeHtml(env.SHOP_SERVICE_EMAIL)}</a>，
          依《消費者保護法》商品到貨後享有 7 天鑑賞期。
        </p>`
      break
    }
  }

  await getTransporter().sendMail({
    from: env.MAIL_FROM,
    to: TO_SERVICE.has(template) ? env.SHOP_SERVICE_EMAIL : order.email,
    subject,
    html: layout(subject.replace(/^【[^】]*】/, ''), body),
  })
}
