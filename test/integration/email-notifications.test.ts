import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { createTestOrder } from '../factories'

/**
 * 通知信整合測試。
 *
 * 只 mock 到 nodemailer 這一層（真的送 SMTP 才是外部依賴），
 * 信件內容一律從真實資料庫組出來 —— 這樣模板改欄位、改文案時
 * 測試抓得到，而 HTML 的 inline style 怎麼調都不會誤報。
 */

interface SentMail {
  from: string
  to: string
  subject: string
  html: string
}

const { sendMailMock } = vi.hoisted(() => ({
  sendMailMock: vi.fn(async (options: { from: string; to: string; subject: string; html: string }) => {
    void options
    return { messageId: 'test-message-id' }
  }),
}))

// email.ts 是 `import nodemailer from 'nodemailer'`，所以要 mock default export。
// transporter 是模組層級單例，跨測試會被快取；只要每條前清掉 sendMailMock 就沒差。
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: sendMailMock })) },
}))

import { env } from '@/lib/env'
import { sendOrderEmail } from '@/lib/email'

beforeEach(() => {
  sendMailMock.mockClear()
})

/** 取最後一封寄出的信 */
function lastMail(): SentMail {
  const call = sendMailMock.mock.calls.at(-1)
  if (!call) throw new Error('沒有寄出任何信')
  return call[0] as SentMail
}

describe('sendOrderEmail：order-confirmed', () => {
  it('主旨含店名/訂單編號/付款成功，收件人是訂單 email，內文含姓名、商品、數量與總計', async () => {
    // 1300 x 2 + 運費 60 = 2660
    const { order } = await createTestOrder({
      status: 'PAID',
      paymentStatus: 'PAID',
      qty: 2,
      unitPrice: 1300,
      shippingFee: 60,
    })

    await sendOrderEmail('order-confirmed', order.id)

    expect(sendMailMock).toHaveBeenCalledTimes(1)
    const mail = lastMail()

    expect(mail.subject).toContain(env.SHOP_NAME)
    expect(mail.subject).toContain(order.orderNo)
    expect(mail.subject).toContain('付款成功')
    expect(mail.to).toBe(order.email)
    expect(mail.to).toBe('buyer@test.local')

    expect(mail.html).toContain('測試買家')
    expect(mail.html).toContain(order.orderNo)
    expect(mail.html).toContain('測試商品')
    expect(mail.html).toContain('單一規格 × 2')
    expect(mail.html).toContain('小計')
    expect(mail.html).toContain('NT$2,600')
    expect(mail.html).toContain('總計')
    expect(mail.html).toContain('NT$2,660')
  })

  it('超商單顯示取貨門市名稱、宅配單顯示收件地址', async () => {
    const { order: cvsOrder } = await createTestOrder({
      status: 'PAID',
      shippingMethod: 'CVS',
    })
    await sendOrderEmail('order-confirmed', cvsOrder.id)
    const cvsHtml = lastMail().html

    expect(cvsHtml).toContain('配送方式：7-ELEVEN 取貨')
    expect(cvsHtml).toContain('取貨門市：測試門市')
    expect(cvsHtml).not.toContain('收件地址')

    const { order: homeOrder } = await createTestOrder({
      status: 'PAID',
      shippingMethod: 'HOME',
    })
    await sendOrderEmail('order-confirmed', homeOrder.id)
    const homeHtml = lastMail().html

    expect(homeHtml).toContain('配送方式：黑貓宅急便')
    expect(homeHtml).toContain('收件地址：台北市中山區測試路 1 號')
    expect(homeHtml).not.toContain('取貨門市')
  })

  it('有折扣時出現折扣列與負數金額，沒折扣時整列不出現', async () => {
    const { order: discounted } = await createTestOrder({
      status: 'PAID',
      qty: 1,
      unitPrice: 1000,
      shippingFee: 60,
      discountTotal: 150,
    })
    await sendOrderEmail('order-confirmed', discounted.id)
    const withDiscount = lastMail().html

    expect(withDiscount).toContain('折扣')
    expect(withDiscount).toContain('-NT$150')
    expect(withDiscount).toContain('NT$910') // 1000 + 60 - 150

    const { order: plain } = await createTestOrder({
      status: 'PAID',
      qty: 1,
      unitPrice: 1000,
      shippingFee: 60,
      discountTotal: 0,
    })
    await sendOrderEmail('order-confirmed', plain.id)
    const noDiscount = lastMail().html

    expect(noDiscount).not.toContain('折扣')
    expect(noDiscount).not.toContain('-NT$')
  })

  it('免運（shippingFee 0）顯示「免運費」而不是 NT$0', async () => {
    const { order } = await createTestOrder({
      status: 'PAID',
      qty: 1,
      unitPrice: 2000,
      shippingFee: 0,
    })

    await sendOrderEmail('order-confirmed', order.id)
    const html = lastMail().html

    expect(html).toContain('運費')
    expect(html).toContain('免運費')
    expect(html).not.toContain('NT$0')
  })
})

describe('sendOrderEmail：payment-info', () => {
  it('ATM：含銀行代碼、虛擬帳號、金額與繳費期限', async () => {
    const { order } = await createTestOrder({
      status: 'PENDING_PAYMENT',
      choosePayment: 'ATM',
      qty: 1,
      unitPrice: 1200,
      shippingFee: 60,
    })
    await db.payment.update({
      where: { orderId: order.id },
      data: { bankCode: '812', vAccount: '9103522175887271', expireDate: '2026/08/20' },
    })

    await sendOrderEmail('payment-info', order.id)
    const mail = lastMail()

    expect(mail.subject).toContain('繳費資訊')
    expect(mail.html).toContain('銀行代碼：<strong>812</strong>')
    expect(mail.html).toContain('虛擬帳號：<strong>9103522175887271</strong>')
    expect(mail.html).toContain('金額：<strong>NT$1,260</strong>')
    expect(mail.html).toContain('繳費期限：2026/08/20')
    expect(mail.html).toContain('逾期未付款的訂單將自動取消並釋放庫存。')
  })

  it('超商代碼：含繳費代碼，且不出現虛擬帳號欄位', async () => {
    const { order } = await createTestOrder({
      status: 'PENDING_PAYMENT',
      choosePayment: 'CVS',
      qty: 1,
      unitPrice: 800,
      shippingFee: 60,
    })
    await db.payment.update({
      where: { orderId: order.id },
      data: { paymentNo: 'LLL22006993456', expireDate: '2026/08/18 23:59:59' },
    })

    await sendOrderEmail('payment-info', order.id)
    const html = lastMail().html

    expect(html).toContain('繳費代碼：<strong>LLL22006993456</strong>')
    expect(html).toContain('金額：<strong>NT$860</strong>')
    expect(html).not.toContain('虛擬帳號')
    expect(html).not.toContain('銀行代碼')
  })

  it('沒有任何繳費資訊時期限顯示破折號，不炸也不留空欄位', async () => {
    const { order } = await createTestOrder({ status: 'PENDING_PAYMENT', choosePayment: 'ATM' })

    await expect(sendOrderEmail('payment-info', order.id)).resolves.toBeUndefined()
    const html = lastMail().html

    expect(html).toContain('繳費期限：—')
    expect(html).not.toContain('虛擬帳號')
    expect(html).not.toContain('繳費代碼')
  })
})

describe('sendOrderEmail：shipped', () => {
  it('主旨含「已出貨」，內文含貨態單號與配送方式', async () => {
    const { order } = await createTestOrder({
      status: 'SHIPPED',
      shippingMethod: 'CVS',
      shipmentStatus: 'IN_TRANSIT',
      shipmentOverrides: { shipmentNo: 'F123456789012' },
    })

    await sendOrderEmail('shipped', order.id)
    const mail = lastMail()

    expect(mail.subject).toContain('已出貨')
    expect(mail.subject).toContain(order.orderNo)
    expect(mail.html).toContain('配送方式：7-ELEVEN 取貨')
    expect(mail.html).toContain('貨態單號：<strong>F123456789012</strong>')
    expect(mail.html).toContain('取貨門市：測試門市')
  })

  it('沒有 shipmentNo 時不炸，也不輸出空的單號欄位', async () => {
    const { order } = await createTestOrder({
      status: 'SHIPPED',
      shippingMethod: 'HOME',
      shipmentStatus: 'IN_TRANSIT',
    })

    await expect(sendOrderEmail('shipped', order.id)).resolves.toBeUndefined()
    const html = lastMail().html

    expect(html).toContain('配送方式：黑貓宅急便')
    expect(html).not.toContain('貨態單號')
    expect(html).not.toContain('<strong></strong>')
  })
})

describe('sendOrderEmail：order-cancelled', () => {
  it('主旨含「已取消」，內文說明逾期未付款且庫存已釋放', async () => {
    const { order } = await createTestOrder({ status: 'CANCELLED', withReservations: false })

    await sendOrderEmail('order-cancelled', order.id)
    const mail = lastMail()

    expect(mail.subject).toContain('已取消')
    expect(mail.subject).toContain(order.orderNo)
    expect(mail.html).toContain('逾期未完成付款已自動取消')
    expect(mail.html).toContain('庫存已釋放')
    expect(mail.html).toContain(order.orderNo)
  })
})

describe('sendOrderEmail：共通行為', () => {
  it('找不到訂單時 throw，訊息帶著 orderId，且不會寄出任何信', async () => {
    await expect(sendOrderEmail('order-confirmed', 'no-such-order-id')).rejects.toThrow(
      'no-such-order-id',
    )
    expect(sendMailMock).not.toHaveBeenCalled()
  })

  it('內容是寄送當下才從 DB 組的：改完收件人姓名再寄一次，第二封是新名字', async () => {
    const { order } = await createTestOrder({ status: 'PAID' })

    await sendOrderEmail('order-confirmed', order.id)
    await db.order.update({ where: { id: order.id }, data: { recipientName: '改名後買家' } })
    await sendOrderEmail('order-confirmed', order.id)

    expect(sendMailMock).toHaveBeenCalledTimes(2)
    const first = sendMailMock.mock.calls[0]![0] as SentMail
    const second = sendMailMock.mock.calls[1]![0] as SentMail

    expect(first.html).toContain('測試買家')
    expect(first.html).not.toContain('改名後買家')
    expect(second.html).toContain('改名後買家')
    expect(second.html).not.toContain('測試買家 您好')
  })

  it('寄件者用 env.MAIL_FROM', async () => {
    const { order } = await createTestOrder({ status: 'PAID' })

    await sendOrderEmail('order-confirmed', order.id)

    expect(lastMail().from).toBe(env.MAIL_FROM)
    expect(lastMail().from).toContain('no-reply@sagon.local')
  })

  it('四個模板的頁尾都有客服信箱與統一編號', async () => {
    const { order } = await createTestOrder({ status: 'PAID' })
    const templates = ['order-confirmed', 'payment-info', 'shipped', 'order-cancelled'] as const

    for (const template of templates) {
      sendMailMock.mockClear()
      await sendOrderEmail(template, order.id)
      const html = lastMail().html

      expect(html, template).toContain(`客服信箱 ${env.SHOP_SERVICE_EMAIL}`)
      expect(html, template).toContain(`統一編號 ${env.SHOP_TAX_ID}`)
      expect(html, template).toContain('本信件由系統自動發送，請勿直接回覆。')
      expect(html, template).toContain(env.SHOP_NAME)
    }
  })

  it('商品名稱與收件人姓名中的 HTML 會被跳脫，不會原樣輸出標籤', async () => {
    const { order } = await createTestOrder({ status: 'PAID' })
    await db.order.update({
      where: { id: order.id },
      data: { recipientName: '王小明 & 家人' },
    })
    await db.orderItem.updateMany({
      where: { orderId: order.id },
      data: { productName: '茶具<script>alert("xss")</script>組', variantName: '「藍 & 白」' },
    })

    await sendOrderEmail('order-confirmed', order.id)
    const html = lastMail().html

    expect(html).not.toContain('<script>')
    expect(html).not.toContain('alert("xss")')
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;')
    expect(html).toContain('王小明 &amp; 家人')
    expect(html).toContain('「藍 &amp; 白」')
  })
})
