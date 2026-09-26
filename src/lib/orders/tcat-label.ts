import 'server-only'
import { db } from '@/lib/db'
import { downloadObt } from '@/lib/tcat/client'
import { saveLabel } from '@/lib/tcat/labels'

/**
 * 黑貓託運單 PDF 的補抓。
 *
 * 正常情況下 PDF 在建單當下就抓回來了（lib/orders/logistics.ts 的 tcatProvider），
 * 這裡處理的是「單建成了、PDF 沒抓到」或「檔案不見了」。
 *
 * 能不能補抓完全取決於 PrintOBT 回的 FileNo：
 *   - 自建單成功起算 **24 小時**有效，過期黑貓就不給了（規格 2.5）
 *   - 人工在黑貓系統建的單根本沒有 FileNo —— 那種只能從黑貓系統列印
 */

/** 規格 2.5：「必須在 24 小時內透過本 API 完成檔案下載」。 */
export const LABEL_FILENO_TTL_MS = 24 * 60 * 60 * 1000

export type LabelAvailability =
  /** PDF 已存在網站上 */
  | 'ready'
  /** 還能向黑貓補抓 */
  | 'downloadable'
  /** 下載編號已過期 */
  | 'expired'
  /** 沒有下載編號（人工在黑貓系統建的單） */
  | 'external'
  /** 還沒有託運單 */
  | 'none'

export function labelAvailability(
  shipment: {
    shipmentNo: string | null
    labelPath: string | null
    labelFileNo: string | null
    labelFileNoIssuedAt: Date | null
  },
  now: Date = new Date(),
): LabelAvailability {
  if (!shipment.shipmentNo) return 'none'
  if (shipment.labelPath) return 'ready'
  if (!shipment.labelFileNo || !shipment.labelFileNoIssuedAt) return 'external'
  return now.getTime() - shipment.labelFileNoIssuedAt.getTime() < LABEL_FILENO_TTL_MS
    ? 'downloadable'
    : 'expired'
}

/**
 * 向黑貓重新下載託運單並存檔。
 *
 * 檔案已存在時也允許重抓（例如 storage/ 沒掛 volume、檔案在重建容器時不見了），
 * 只要下載編號還在期限內。
 */
export async function redownloadTcatLabel(orderId: string, now: Date = new Date()): Promise<string> {
  const shipment = await db.shipment.findUnique({
    where: { orderId },
    select: {
      id: true,
      logisticsSubType: true,
      shipmentNo: true,
      labelFileNo: true,
      labelFileNoIssuedAt: true,
      order: { select: { orderNo: true } },
    },
  })

  if (!shipment || shipment.logisticsSubType !== 'TCAT') {
    throw new Error('只有黑貓宅配的訂單有託運單')
  }
  if (!shipment.shipmentNo) throw new Error('這張訂單還沒有建立託運單')
  if (!shipment.labelFileNo || !shipment.labelFileNoIssuedAt) {
    throw new Error('這張託運單不是由網站建立的，網站拿不到它的檔案，請從黑貓系統列印')
  }
  if (now.getTime() - shipment.labelFileNoIssuedAt.getTime() >= LABEL_FILENO_TTL_MS) {
    throw new Error('已超過黑貓的 24 小時下載期限，請從黑貓系統列印這張託運單')
  }

  // 只要這一張 —— FileNo 底下可能不只一張單（批次建單時）
  const pdf = await downloadObt(shipment.labelFileNo, [shipment.shipmentNo])
  const labelPath = await saveLabel(shipment.order.orderNo, pdf)

  await db.shipment.update({
    where: { id: shipment.id },
    // failReason 在已成立的黑貓單上只會放「PDF 沒抓到」的警告，抓到了就清掉
    data: { labelPath, labelDownloadedAt: now, failReason: null },
  })

  return labelPath
}
