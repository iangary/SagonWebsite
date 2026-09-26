import 'server-only'
import type { ShipmentStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { queryObtStatus, TcatApiError, type TcatObtStatus } from '@/lib/tcat/client'
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
export const POLL_INTERVAL_MS = 2 * 60 * 60 * 1000

export interface TcatPollResult {
  polled: number
  logsCreated: number
  statusChanged: number
}

const POLL_SELECT = { id: true, orderId: true, shipmentNo: true, status: true } as const

type PollTarget = { id: string; orderId: string; shipmentNo: string | null; status: ShipmentStatus }

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
    select: POLL_SELECT,
    orderBy: { statusPolledAt: { sort: 'asc', nulls: 'first' } },
    take: TCAT_LIMITS.obtStatus,
  })

  return pollShipments(shipments)
}

/**
 * 後台「立即查詢貨態」：只查這一張，但一樣守黑貓的 2 小時限制 ——
 * 超過限制黑貓會直接拒絕，而且算不算進每日配額沒寫，不值得賭。
 */
export async function refreshTcatShipmentStatus(
  orderId: string,
  now: Date = new Date(),
): Promise<TcatPollResult> {
  const shipment = await db.shipment.findUnique({
    where: { orderId },
    select: { ...POLL_SELECT, logisticsSubType: true, statusPolledAt: true },
  })

  if (!shipment || shipment.logisticsSubType !== 'TCAT') {
    throw new Error('只有黑貓宅配的訂單能查黑貓貨態')
  }
  if (!shipment.shipmentNo) throw new Error('這張訂單還沒有黑貓託運單號')

  if (shipment.statusPolledAt) {
    const nextAt = new Date(shipment.statusPolledAt.getTime() + POLL_INTERVAL_MS)
    if (nextAt > now) {
      const time = nextAt.toLocaleTimeString('zh-TW', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Taipei',
      })
      throw new Error(`黑貓限制同一張單每 2 小時只能查一次，${time} 之後可以再查`)
    }
  }

  return pollShipments([shipment])
}

async function pollShipments(shipments: PollTarget[]): Promise<TcatPollResult> {
  if (shipments.length === 0) return { polled: 0, logsCreated: 0, statusChanged: 0 }

  const ids = shipments.map((s) => s.id)
  const obtNumbers = shipments.map((s) => s.shipmentNo!).filter(Boolean)

  let statuses: TcatObtStatus[]
  try {
    statuses = await queryObtStatus(obtNumbers)
  } catch (error) {
    // 黑貓明確拒絕（E009 憑證錯誤、超過查詢限制…）：把原因寫在單上讓後台看得到，
    // 再往外丟讓 worker 記一筆失敗。statusPolledAt 不動 —— 這次根本沒查到。
    if (error instanceof TcatApiError) {
      await db.shipment.updateMany({
        where: { id: { in: ids } },
        data: { statusPollError: error.message.slice(0, 500) },
      })
    }
    throw error
  }
  const byObtNumber = new Map(statuses.map((s) => [s.OBTNumber, s]))

  // 不論查到沒有都要記時間 —— 剛建單還沒集貨時黑貓回的是「無貨態明細」，
  // 沒記的話下一輪又會馬上查同一批，白白吃掉配額。
  const polledAt = new Date()
  await db.shipment.updateMany({
    where: { id: { in: ids } },
    data: { statusPolledAt: polledAt, statusPollError: null },
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
