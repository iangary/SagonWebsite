'use server'

import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import type { LogisticsSubType } from '@prisma/client'
import { auth } from '@/lib/auth'
import { CHECKOUT_LOGIN_HREF } from '@/lib/auth/checkout-gate'
import { createOrderFromCart } from '@/lib/orders/create'
import { normalizeTwMobile } from '@/lib/sms/provider'

const CVS_SUBTYPES = ['UNIMARTC2C', 'FAMIC2C', 'HILIFEC2C', 'OKMARTC2C'] as const
/** 宅配只有黑貓（我們自己簽約的，不經綠界） */
const HOME_SUBTYPES = ['TCAT'] as const

const schema = z
  .object({
    // 訊息存的是 messages 的 validation.* key，回應時才翻 —— schema 是模組層級的
    // 常數，建立時還沒有請求，拿不到語系。
    email: z.string().trim().toLowerCase().email('emailInvalid'),
    recipientName: z.string().trim().min(1, 'recipientNameRequired').max(50),
    recipientPhone: z.string().trim().min(1, 'recipientPhoneRequired'),

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

    // COD = 貨到付款（由物流代收，不經綠界金流）。開關在後台，createOrderFromCart 會再驗一次。
    choosePayment: z.enum(['Credit', 'ATM', 'CVS', 'BARCODE', 'COD']),
    couponCode: z.string().trim().optional().default(''),
    note: z.string().trim().max(500).optional().default(''),

    // 發票是人工開立的紙本，隨包裹寄出 —— 沒有載具與捐贈這些電子發票專屬的機制
    invoiceType: z.enum(['PERSONAL', 'COMPANY']),
    taxId: z.string().trim().optional().default(''),
    companyName: z.string().trim().optional().default(''),
  })
  .superRefine((data, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message })

    if (data.shippingMethod === 'CVS') {
      if (!CVS_SUBTYPES.includes(data.logisticsSubType as (typeof CVS_SUBTYPES)[number])) {
        issue('logisticsSubType', 'cvsChannelRequired')
      }
      if (!data.cvsStoreId) issue('cvsStoreId', 'cvsStoreRequired')
    } else {
      if (!HOME_SUBTYPES.includes(data.logisticsSubType as (typeof HOME_SUBTYPES)[number])) {
        issue('logisticsSubType', 'homeCarrierRequired')
      }
      if (!/^\d{3,5}$/.test(data.addressZip)) issue('addressZip', 'zipRequired')
      if (!data.addressCity) issue('addressCity', 'cityRequired')
      if (!data.addressDistrict) issue('addressDistrict', 'districtRequired')
      if (!data.addressLine) issue('addressLine', 'addressLineRequired')
    }

    if (data.invoiceType === 'COMPANY') {
      if (!/^\d{8}$/.test(data.taxId)) issue('taxId', 'taxIdFormat')
      if (!data.companyName) issue('companyName', 'companyNameRequired')
    }
  })

export type CheckoutState = {
  ok: boolean
  error?: string
  fieldErrors?: Record<string, string>
  /** 前端要導去的網址：成功時是付款頁，未登入被擋下時是登入頁 */
  redirectTo?: string
}

export async function submitCheckout(
  _prev: CheckoutState,
  formData: FormData,
): Promise<CheckoutState> {
  // 只有會員能結帳。結帳頁進來時就擋過一次，這裡是為了「填單填到一半 session
  // 過期」與直接打 Server Action 的情況 —— 帶著網址把人送回登入頁。
  const session = await auth()
  if (!session?.user?.id) {
    const t = await getTranslations('errors')
    return {
      ok: false,
      error: t('loginRequiredForCheckout'),
      redirectTo: CHECKOUT_LOGIN_HREF,
    }
  }

  const raw = Object.fromEntries(formData.entries()) as Record<string, string>
  const parsed = schema.safeParse(raw)

  if (!parsed.success) {
    const t = await getTranslations('validation')
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '_')
      fieldErrors[key] ??= t(issue.message)
    }
    return { ok: false, fieldErrors }
  }

  const data = parsed.data

  const phone = normalizeTwMobile(data.recipientPhone)
  if (!phone) {
    const t = await getTranslations('validation')
    return { ok: false, fieldErrors: { recipientPhone: t('phoneInvalid') } }
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
    },
  })

  if (!result.ok) return { ok: false, error: result.error }

  return {
    ok: true,
    // 貨到付款沒有收銀台可以去，直接看訂單結果頁
    redirectTo: result.isCod
      ? `/checkout/result?orderNo=${result.orderNo}`
      : `/api/ecpay/payment/checkout/${result.orderNo}`,
  }
}
