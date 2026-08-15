import 'server-only'
import { db } from '@/lib/db'
import { queryObtStatus, type TcatObtStatus } from '@/lib/tcat/client'
import { TCAT_LIMITS } from '@/lib/tcat/config'
import { mapTcatStatus, parseTcatDateTime } from '@/lib/tcat/fields'
import { advanceOrderForShipmentStatus } from './logistics'

/**
 * 黑貓貨態輪詢。
 *
 * 黑貓沒有貨態回拋（綠界有），只能自己去問。而規格 2.11.1 的限制很緊：
 *   - 每契客每日最多 3,000 次
 *   - 同時最多 3 個查詢
 *   - **同一託運單號每 2 小時只能查一次**
 *
 * 所以：每批最多 10 筆（API 上限）、只撈超過 2 小時沒查過的、查完就記 statusPolledAt。
 * 由 worker 每 30 分鐘跑一次。
 */

/** 同一張單兩次查詢至少要隔這麼久，否則會被黑貓擋。 */
const POLL_INTERVAL_MS = 2 * 60 * 60 * 1000

export interface TcatPollResult {
  polled: number
  logsCreated: number
  statusChanged: number
}

export async function pollTcatShipmentStatuses(): Promise<TcatPollResult> {
  const cutoff = new Date(Date.now() - POLL_INTERVAL_MS)

  const shipments = await db.shipment.findMany({
    where: {
      logisticsSubType: 'TCAT',
      shipmentNo: { not: null },
      // 已取貨／已退回的單不用再查，貨態不會再變
      status: { in: ['CREATED', 'IN_TRANSIT', 'ARRIVED'] },
      OR: [{ statusPolledAt: null }, { statusPolledAt: { lt: cutoff } }],
    },
    select: { id: true, orderId: true, shipmentNo: true, status: true },
    orderBy: { statusPolledAt: { sort: 'asc', nulls: 'first' } },
    take: TCAT_LIMITS.obtStatus,
  })

  if (shipments.length === 0) return { polled: 0, logsCreated: 0, statusChanged: 0 }

  const obtNumbers = shipments.map((s) => s.shipmentNo!).filter(Boolean)
  const statuses = await queryObtStatus(obtNumbers)
  const byObtNumber = new Map(statuses.map((s) => [s.OBTNumber, s]))

  // 不論查到沒有都要記時間 —— 剛建單還沒集貨時黑貓回的是「無貨態明細」，
  // 沒記的話下一輪又會馬上查同一批，白白吃掉配額。
  const polledAt = new Date()
  await db.shipment.updateMany({
    where: { id: { in: shipments.map((s) => s.id) } },
    data: { statusPolledAt: polledAt },
  })

  let logsCreated = 0
  let statusChanged = 0

  for (const shipment of shipments) {
    const obt = byObtNumber.get(shipment.shipmentNo!)
    if (!obt) continue

    logsCreated += await recordStatusHistory(shipment.id, obt)

    const mapped = mapTcatStatus(obt.StatusId)

    await db.shipment.update({
      where: { id: shipment.id },
      data: {
        statusCode: obt.StatusId,
        statusMsg: obt.StatusName.slice(0, 500),
        // 對不到的代碼只留歷程，不動狀態（附錄一的「異常」欄位是調查中，包裹還在路上）
        ...(mapped ? { status: mapped } : {}),
      },
    })

    if (mapped && mapped !== shipment.status) {
      statusChanged += 1
      await advanceOrderForShipmentStatus(shipment.orderId, mapped)
    }
  }

  return { polled: shipments.length, logsCreated, statusChanged }
}

/**
 * 把 StatusList 補進 LogisticsStatusLog。
 *
 * 每次查詢都會回傳完整歷程（由新到舊），所以一定要去重，否則輪詢幾輪之後
 * 後台的物流軌跡就會變成同一段訊息重複十幾次。
 * 用「代碼 + 發生時間」當識別 —— 黑貓沒有給每筆貨態一個 id。
 */
async function recordStatusHistory(shipmentId: string, obt: TcatObtStatus): Promise<number> {
  const existing = await db.logisticsStatusLog.findMany({
    where: { shipmentId },
    select: { statusCode: true, occurredAt: true },
  })
  const seen = new Set(existing.map((log) => `${log.statusCode}@${log.occurredAt.getTime()}`))

  const fresh = obt.StatusList.map((entry) => {
    const occurredAt = parseTcatDateTime(entry.CreateDateTime)
    return occurredAt ? { entry, occurredAt } : null
  })
    .filter((v) => v !== null)
    .filter(({ entry, occurredAt }) => !seen.has(`${entry.StatusId}@${occurredAt.getTime()}`))

  if (fresh.length === 0) return 0

  await db.logisticsStatusLog.createMany({
    data: fresh.map(({ entry, occurredAt }) => ({
      shipmentId,
      statusCode: entry.StatusId,
      // 營業所名稱對客服很有用（「現在在台南營業所」），一起存進訊息裡
      message: entry.StationName ? `${entry.StatusName}（${entry.StationName}）` : entry.StatusName,
      occurredAt,
      raw: entry as unknown as object,
    })),
  })

  return fresh.length
}
