import type {
  OrderStatus,
  PaymentStatus,
  ShipmentStatus,
  InvoiceStatus,
  ReceiptStatus,
} from '@prisma/client'

/** 後台一律用繁中顯示，不走 i18n（後台只有一種語言）。 */

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_PAYMENT: '待付款',
  PAID: '已付款',
  PROCESSING: '備貨中',
  SHIPPED: '已出貨',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  REFUNDED: '已退款',
}

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  PENDING: '尚未付款',
  AWAITING_TRANSFER: '已取號，等待付款',
  PAID: '已付款',
  FAILED: '付款失敗',
  EXPIRED: '已逾期',
  REFUNDED: '已退款',
}

export const SHIPMENT_STATUS_LABEL: Record<ShipmentStatus, string> = {
  PENDING: '尚未建單',
  CREATED: '已建單',
  IN_TRANSIT: '運送中',
  ARRIVED: '已到店／配送中',
  PICKED_UP: '已取貨',
  RETURNED: '已退回',
  FAILED: '建單失敗',
}

/** 紙本統一發票由人工開立，沒有「開立失敗」這種狀態 */
export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  PENDING: '尚未開立',
  ISSUED: '已開立',
  VOIDED: '已作廢',
}

export const RECEIPT_STATUS_LABEL: Record<ReceiptStatus, string> = {
  PENDING: '尚未開立',
  ISSUED: '已開立',
  VOIDED: '已作廢',
  FAILED: '開立失敗',
}

export const CHOOSE_PAYMENT_LABEL: Record<string, string> = {
  Credit: '信用卡',
  ATM: 'ATM 虛擬帳號',
  CVS: '超商代碼繳費',
  BARCODE: '超商條碼',
  ALL: '未指定',
}
