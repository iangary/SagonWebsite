import 'server-only'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { isCheckoutCvsSubType, type CheckoutCvsSubType } from '@/lib/checkout-options'

/**
 * 回購會員的結帳預填。
 *
 * 不另開一張「結帳偏好」表 —— 訂單本身就是會員上次填了什麼的快照，
 * 直接從最近一筆訂單推，就不會有「偏好表跟訂單對不上」的問題。
 * 唯一的例外是宅配地址：訂單只存 `區 + 路` 合併後的字串（見 create.ts），
 * 拆不回來，所以宅配地址改由下單時寫進地址簿（rememberCheckoutDetails）。
 *
 * **只帶入、不寫回 `User.email` / `User.phone`。** 這兩欄是登入憑證：
 * 沒驗證過的信箱寫進去，Google 登入的 allowDangerousEmailAccountLinking
 * 就會把信箱真正的主人連到這個帳號；手機號碼同理會被 OTP 登入撿走。
 */

// 只帶入結帳還開放的通路：上次用萊爾富／OK 取貨的會員，這次改回預設的 7-11 重選門市
type CvsSubType = CheckoutCvsSubType

const PAYMENT_CHOICES = ['Credit', 'ATM', 'CVS', 'BARCODE', 'BANK', 'COD'] as const
type PaymentChoice = (typeof PAYMENT_CHOICES)[number]

export const PREFILL_ADDRESS_SELECT = {
  recipient: true,
  phone: true,
  zip: true,
  city: true,
  district: true,
  line1: true,
} satisfies Prisma.AddressSelect

export type PrefillAddress = Prisma.AddressGetPayload<{ select: typeof PREFILL_ADDRESS_SELECT }>

export type CheckoutPrefill = {
  /** 有沒有從過去的訂單帶入東西 —— 結帳頁據此顯示「已帶入上次的資料」 */
  fromPreviousOrder: boolean
  recipientName: string
  recipientPhone: string
  email: string
  shippingMethod: 'CVS' | 'HOME'
  cvsSubType: CvsSubType
  /** 上次取貨的門市。換了通路或要改貨到付款時，前端會要求重選。 */
  cvsStore: {
    subType: CvsSubType
    storeId: string
    storeName: string
    address: string
    telephone: string
    /** 當初是不是用「代收貨款」篩過的門市 —— 不是的話不能直接拿來貨到付款 */
    collection: boolean
  } | null
  address: PrefillAddress | null
  choosePayment: PaymentChoice | null
  invoiceType: 'PERSONAL' | 'COMPANY'
  taxId: string
  companyName: string
}

const isCvsSubType = isCheckoutCvsSubType

function isPaymentChoice(value: string): value is PaymentChoice {
  return (PAYMENT_CHOICES as readonly string[]).includes(value)
}

export async function getCheckoutPrefill(
  userId: string,
  fallbackEmail: string | null | undefined,
): Promise<CheckoutPrefill> {
  const [user, lastOrder, lastCompanyInvoice, address] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { name: true, email: true, phone: true } }),
    db.order.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        email: true,
        recipientName: true,
        recipientPhone: true,
        shippingMethod: true,
        shipment: {
          select: {
            logisticsSubType: true,
            cvsStoreId: true,
            cvsStoreName: true,
            cvsAddress: true,
            cvsTelephone: true,
            isCollection: true,
          },
        },
        invoice: { select: { isB2B: true } },
        // 改過付款方式會有好幾筆，生效的是沒被取代的那筆
        payments: {
          where: { supersededAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { choosePayment: true },
        },
      },
    }),
    // 統編與抬頭另外找：上次開個人發票，不代表公司資料就沒用了
    db.invoice.findFirst({
      where: { isB2B: true, taxId: { not: null }, order: { userId } },
      orderBy: { createdAt: 'desc' },
      select: { taxId: true, companyName: true },
    }),
    // 最近用過（或改過）的地址 —— 結帳存地址時會更新 updatedAt
    db.address.findFirst({
      where: { userId },
      orderBy: [{ updatedAt: 'desc' }],
      select: PREFILL_ADDRESS_SELECT,
    }),
  ])

  const shipment = lastOrder?.shipment
  const cvsStore =
    lastOrder?.shippingMethod === 'CVS' &&
    shipment?.cvsStoreId &&
    isCvsSubType(shipment.logisticsSubType)
      ? {
          subType: shipment.logisticsSubType,
          storeId: shipment.cvsStoreId,
          storeName: shipment.cvsStoreName ?? '',
          address: shipment.cvsAddress ?? '',
          telephone: shipment.cvsTelephone ?? '',
          collection: shipment.isCollection,
        }
      : null

  const lastPayment = lastOrder?.payments[0]?.choosePayment

  return {
    fromPreviousOrder: Boolean(lastOrder),
    recipientName: lastOrder?.recipientName ?? address?.recipient ?? defaultName(user?.name),
    recipientPhone: lastOrder?.recipientPhone ?? address?.phone ?? user?.phone ?? '',
    email: lastOrder?.email ?? user?.email ?? fallbackEmail ?? '',
    shippingMethod: lastOrder?.shippingMethod ?? 'CVS',
    cvsSubType: cvsStore?.subType ?? 'UNIMARTC2C',
    cvsStore,
    address,
    choosePayment: lastPayment && isPaymentChoice(lastPayment) ? lastPayment : null,
    invoiceType: lastOrder?.invoice?.isB2B ? 'COMPANY' : 'PERSONAL',
    taxId: lastCompanyInvoice?.taxId ?? '',
    companyName: lastCompanyInvoice?.companyName ?? '',
  }
}

/** 手機 OTP 登入自動開的帳號叫「會員1234」，那不是真名，不拿來當收件人 */
const PLACEHOLDER_NAME = /^會員\d{4}$/

function defaultName(name: string | null | undefined): string {
  return name && !PLACEHOLDER_NAME.test(name) ? name : ''
}

export type RememberCheckoutInput = {
  recipientName: string
  /** 已正規化的手機號碼 */
  recipientPhone: string
  /** 宅配才有；有給才會存進地址簿 */
  address?: { zip: string; city: string; district: string; line1: string }
}

/**
 * 下單成功後，把這次填的資料補進會員資料：
 *  - 宅配地址存進地址簿（同一個地址不重複存，只更新「最近使用」）
 *  - 會員沒有名字、或還是 OTP 自動取的「會員1234」時，補上收件人姓名
 *
 * 訂單已經成立了，這裡失敗不能讓下單失敗 —— 呼叫端只記 log。
 */
export async function rememberCheckoutDetails(
  userId: string,
  input: RememberCheckoutInput,
): Promise<void> {
  await db.$transaction(async (tx) => {
    if (input.address) {
      const data = {
        recipient: input.recipientName,
        phone: input.recipientPhone,
        ...input.address,
      }
      const existing = await tx.address.findFirst({
        where: { userId, ...data },
        select: { id: true },
      })
      if (existing) {
        // 內容一樣，只是把它標成最近用過的，下次結帳就帶這一筆
        await tx.address.update({ where: { id: existing.id }, data: { updatedAt: new Date() } })
      } else {
        const count = await tx.address.count({ where: { userId } })
        // 第一筆地址自動設為預設，與會員中心新增地址的規則一致
        await tx.address.create({ data: { ...data, userId, isDefault: count === 0 } })
      }
    }

    const user = await tx.user.findUnique({ where: { id: userId }, select: { name: true } })
    if (user && !defaultName(user.name)) {
      await tx.user.update({ where: { id: userId }, data: { name: input.recipientName } })
    }
  })
}
