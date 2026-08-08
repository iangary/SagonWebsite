'use server'

import { z } from 'zod'
import type { LogisticsSubType } from '@prisma/client'
import { createOrderFromCart } from '@/lib/orders/create'
import { normalizeTwMobile } from '@/lib/sms/provider'

const CVS_SUBTYPES = ['UNIMARTC2C', 'FAMIC2C', 'HILIFEC2C', 'OKMARTC2C'] as const
const HOME_SUBTYPES = ['TCAT', 'POST'] as const

const schema = z
  .object({
    email: z.string().trim().toLowerCase().email('請輸入正確的 Email'),
    recipientName: z.string().trim().min(1, '請輸入收件人姓名').max(50),
    recipientPhone: z.string().trim().min(1, '請輸入收件人手機'),

    shippingMethod: z.enum(['CVS', 'HOME']),
    logisticsSubType: z.enum([...CVS_SUBTYPES, ...HOME_SUBTYPES]),

    cvsStoreId: z.string().trim().optional().default(''),
    cvsStoreName: z.string().trim().optional().default(''),
    cvsAddress: z.string().trim().optional().default(''),
    cvsTelephone: z.string().trim().optional().default(''),

    addressZip: z.string().trim().optional().default(''),
    addressCity: z.string().trim().optional().default(''),
    addressDistrict: z.string().trim().optional().default(''),
    addressLine: z.string().trim().optional().default(''),

    choosePayment: z.enum(['Credit', 'ATM', 'CVS']),
    couponCode: z.string().trim().optional().default(''),
    note: z.string().trim().max(500).optional().default(''),

    invoiceType: z.enum(['MEMBER', 'MOBILE', 'DONATE', 'COMPANY']),
    carrierNum: z.string().trim().optional().default(''),
    loveCode: z.string().trim().optional().default(''),
    taxId: z.string().trim().optional().default(''),
    companyName: z.string().trim().optional().default(''),
  })
  .superRefine((data, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message })

    if (data.shippingMethod === 'CVS') {
      if (!CVS_SUBTYPES.includes(data.logisticsSubType as (typeof CVS_SUBTYPES)[number])) {
        issue('logisticsSubType', '請選擇超商通路')
      }
      if (!data.cvsStoreId) issue('cvsStoreId', '請選擇取貨門市')
    } else {
      if (!HOME_SUBTYPES.includes(data.logisticsSubType as (typeof HOME_SUBTYPES)[number])) {
        issue('logisticsSubType', '請選擇宅配物流商')
      }
      if (!/^\d{3,5}$/.test(data.addressZip)) issue('addressZip', '請輸入郵遞區號')
      if (!data.addressCity) issue('addressCity', '請選擇縣市')
      if (!data.addressDistrict) issue('addressDistrict', '請輸入鄉鎮市區')
      if (!data.addressLine) issue('addressLine', '請輸入詳細地址')
    }

    // 手機條碼載具格式：斜線加 7 碼大寫英數
    if (data.invoiceType === 'MOBILE' && !/^\/[0-9A-Z.\-+]{7}$/.test(data.carrierNum)) {
      issue('carrierNum', '手機條碼格式為斜線加 7 碼，例如 /ABC1234')
    }
    if (data.invoiceType === 'DONATE' && !/^\d{3,7}$/.test(data.loveCode)) {
      issue('loveCode', '愛心碼為 3–7 位數字')
    }
    if (data.invoiceType === 'COMPANY') {
      if (!/^\d{8}$/.test(data.taxId)) issue('taxId', '統一編號為 8 位數字')
      if (!data.companyName) issue('companyName', '請輸入公司抬頭')
    }
  })

export type CheckoutState = {
  ok: boolean
  error?: string
  fieldErrors?: Record<string, string>
  /** 成功時前端要導向的付款網址 */
  redirectTo?: string
}

export async function submitCheckout(
  _prev: CheckoutState,
  formData: FormData,
): Promise<CheckoutState> {
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>
  const parsed = schema.safeParse(raw)

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '_')
      fieldErrors[key] ??= issue.message
    }
    return { ok: false, fieldErrors }
  }

  const data = parsed.data

  const phone = normalizeTwMobile(data.recipientPhone)
  if (!phone) {
    return { ok: false, fieldErrors: { recipientPhone: '請輸入正確的台灣手機號碼' } }
  }

  const result = await createOrderFromCart({
    email: data.email,
    phone,
    recipientName: data.recipientName,
    recipientPhone: phone,
    shippingMethod: data.shippingMethod,
    logisticsSubType: data.logisticsSubType as LogisticsSubType,
    cvsStoreId: data.cvsStoreId || undefined,
    cvsStoreName: data.cvsStoreName || undefined,
    cvsAddress: data.cvsAddress || undefined,
    cvsTelephone: data.cvsTelephone || undefined,
    addressZip: data.addressZip || undefined,
    addressCity: data.addressCity || undefined,
    addressDistrict: data.addressDistrict || undefined,
    addressLine: data.addressLine || undefined,
    choosePayment: data.choosePayment,
    couponCode: data.couponCode || undefined,
    note: data.note || undefined,
    invoice: {
      isB2B: data.invoiceType === 'COMPANY',
      taxId: data.invoiceType === 'COMPANY' ? data.taxId : undefined,
      companyName: data.invoiceType === 'COMPANY' ? data.companyName : undefined,
      carrierType:
        data.invoiceType === 'MOBILE' ? 'MOBILE' : data.invoiceType === 'MEMBER' ? 'MEMBER' : 'NONE',
      carrierNum: data.invoiceType === 'MOBILE' ? data.carrierNum : undefined,
      donation: data.invoiceType === 'DONATE',
      loveCode: data.invoiceType === 'DONATE' ? data.loveCode : undefined,
    },
  })

  if (!result.ok) return { ok: false, error: result.error }

  return {
    ok: true,
    redirectTo: `/api/ecpay/payment/checkout/${result.orderNo}`,
  }
}
