import type { TcatOrder } from './client'
import {
  normalizeMobile,
  normalizeTel,
  sanitizeAddress,
  sanitizeName,
  sanitizeOrderId,
  sanitizeProductName,
  shipmentDates,
  specForOrder,
  THERMOSPHERE_NORMAL,
  type TcatSpec,
} from './fields'

/**
 * 把一張訂單組成黑貓要的 Orders[] 單筆。
 *
 * 純函式（連時間都從外面傳進來），這樣可以完整測出「什麼樣的訂單會組出什麼電文」。
 * 所有清洗規則都在 fields.ts，這裡只負責挑欄位與套用固定的商業決定。
 */

/** 代收貨款超過這個金額才需要報值（黑貓的賠償上限就是 2 萬）。 */
export const DECLARE_THRESHOLD = 20_000

export interface TcatOrderInput {
  orderNo: string
  recipientName: string
  recipientTel?: string | null
  recipientMobile: string
  recipientAddress: string
  /** 由 ParsingAddress 查出來、已取後六碼的寄件人黑貓郵碼 */
  senderZip: string
  senderName: string
  senderTel?: string | null
  senderMobile: string
  senderAddress: string
  /** 商品名稱（多品項時由呼叫端組成「X 等 N 項」） */
  productName: string
  /** 訂單總件數，用來推材積 */
  totalQuantity: number
  /**
   * 代收貨款金額（貨到付款）。0 或不給 = 不代收。
   * 黑貓的代收超過 2 萬要一併報值，否則遺失時只能按上限賠。
   */
  collectionAmount?: number
}

export interface TcatOrderConfig {
  productTypeId: string
  defaultSpec: TcatSpec
  specQtyStep: number
}

export class TcatOrderInvalid extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TcatOrderInvalid'
  }
}

export function buildTcatOrder(
  input: TcatOrderInput,
  config: TcatOrderConfig,
  now: Date = new Date(),
): TcatOrder {
  const recipientName = sanitizeName(input.recipientName)
  const recipientTel = normalizeTel(input.recipientTel)
  const recipientMobile = normalizeMobile(input.recipientMobile)
  const recipientAddress = sanitizeAddress(input.recipientAddress)

  const senderTel = normalizeTel(input.senderTel)
  const senderMobile = normalizeMobile(input.senderMobile)

  // 先擋掉一定會被退件的組合。這些丟出去只會拿到 E0xx 而且託運單不會成立，
  // 不如在這裡就明確報錯，讓呼叫端轉人工處理。
  if (!recipientName) {
    throw new TcatOrderInvalid('收件人姓名清洗後是空的')
  }
  // E027：收件人電話、手機須擇一填寫
  if (!recipientTel && !recipientMobile) {
    throw new TcatOrderInvalid('收件人電話與手機都不是有效格式，至少要有一個')
  }
  // E028：寄件人電話、手機須擇一填寫
  if (!senderTel && !senderMobile) {
    throw new TcatOrderInvalid('寄件人電話與手機都不是有效格式，請檢查 ECPAY_SENDER_* 設定')
  }
  if (!recipientAddress) {
    throw new TcatOrderInvalid('收件人地址是空的')
  }

  const { shipmentDate, deliveryDate } = shipmentDates(now)
  // 金額一律取整數且不接受負數 —— 黑貓的欄位是整數，送小數會被退件
  const collection = Math.max(0, Math.round(input.collectionAmount ?? 0))

  return {
    // 列印類別 01 = 由系統配號，所以託運單號留空
    OBTNumber: '',
    OrderId: sanitizeOrderId(input.orderNo),
    Thermosphere: THERMOSPHERE_NORMAL,
    Spec: specForOrder(
      input.totalQuantity,
      config.defaultSpec,
      config.specQtyStep,
      THERMOSPHERE_NORMAL,
    ),
    // 01 = 到宅。到所（02）才需要收付處編號，這裡固定留空
    ReceiptLocation: '01',
    ReceiptStationNo: '',
    RecipientName: recipientName,
    RecipientTel: recipientTel,
    RecipientMobile: recipientMobile,
    RecipientAddress: recipientAddress,
    SenderName: sanitizeName(input.senderName),
    SenderTel: senderTel,
    SenderMobile: senderMobile,
    SenderZipCode: input.senderZip,
    SenderAddress: sanitizeAddress(input.senderAddress),
    ShipmentDate: shipmentDate,
    DeliveryDate: deliveryDate,
    // 04 = 不指定。指定時段配送失敗率較高，且結帳流程沒有讓客戶選
    DeliveryTime: '04',
    // 運費一律是我們付（月結），所以永遠 N；貨款則看訂單是不是貨到付款
    IsFreight: 'N',
    IsCollection: collection > 0 ? 'Y' : 'N',
    CollectionAmount: collection,
    // 司機的行動刷卡與行動支付要另外申請，沒開通就只能收現金
    IsSwipe: 'N',
    IsMobilePay: 'N',
    // 報值只在代收金額超過 2 萬時才有意義（遺失時的賠償上限）
    IsDeclare: collection > DECLARE_THRESHOLD ? 'Y' : 'N',
    DeclareAmount: collection > DECLARE_THRESHOLD ? collection : 0,
    ProductTypeId: config.productTypeId,
    ProductName: sanitizeProductName(input.productName),
    Memo: '',
  }
}

/** 商品名稱：單品用原名，多品項用「第一項 等 N 項」。 */
export function goodsNameFor(items: { productName: string }[]): string {
  const first = items[0]?.productName ?? '商品'
  return items.length === 1 ? first : `${first} 等 ${items.length} 項`
}

/** 訂單總件數。 */
export function totalQuantityOf(items: { qty: number }[]): number {
  return items.reduce((sum, item) => sum + item.qty, 0)
}
