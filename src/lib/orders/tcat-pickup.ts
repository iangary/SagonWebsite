import 'server-only'
import { Prisma, type TcatPickupCall } from '@prisma/client'
import { db } from '@/lib/db'
import { senderConfig } from '@/lib/ecpay/config'
import { callPickup } from '@/lib/tcat/client'
import { tcatPickupConfig } from '@/lib/tcat/config'
import { formatTcatDate } from '@/lib/tcat/fields'
import { buildPickupCall, composePickupMemo } from '@/lib/tcat/pickup'

/**
 * 呼叫黑貓來收貨（規格 2.6）。
 *
 * 這是倉庫層級的動作，不是每張訂單各叫一次 —— 規格限制「每個收貨點每日僅能使用一次」，
 * 且無法預約時段，司機依當日路線過來。所以：
 *   - 只由後台按鈕觸發（包好了沒只有現場的人知道，排程猜不準）
 *   - 不進 BullMQ（會自動重試的東西碰這支 API 就是叫兩台車）
 *   - 用 TcatPickupCall 當每日一次的鎖
 *
 * 「這趟收哪幾張」：黑貓的 Call API 只收件數，沒有單號欄位。所以由後台勾選訂單，
 * 件數照勾選數算、單號寫進備註，成功後把這些 shipment 掛到該筆 TcatPickupCall 上。
 */

/**
 * 待交寄：託運單已成立、貨態還沒進到集貨、也還沒排進任何一趟收貨的黑貓單。
 * CREATED = 已配號還在我們手上；一旦進 IN_TRANSIT 就代表司機收走了。
 */
const PENDING_PARCEL_WHERE = {
  logisticsSubType: 'TCAT',
  shipmentNo: { not: null },
  status: 'CREATED',
  pickupCallId: null,
} satisfies Prisma.ShipmentWhereInput

export async function pendingTcatParcelCount(): Promise<number> {
  return db.shipment.count({ where: PENDING_PARCEL_WHERE })
}

export const PENDING_PARCEL_SELECT = {
  id: true,
  shipmentNo: true,
  receiverName: true,
  receiverAddress: true,
  labelPath: true,
  createdAt: true,
  order: { select: { id: true, orderNo: true } },
} satisfies Prisma.ShipmentSelect

export type PendingParcel = Prisma.ShipmentGetPayload<{ select: typeof PENDING_PARCEL_SELECT }>

/** 一次叫車最多勾幾張。沒有規格限制，純粹防呆（一般一天不會超過這個量）。 */
export const PICKUP_MAX_SHIPMENTS = 200

export async function listPendingTcatParcels(): Promise<PendingParcel[]> {
  return db.shipment.findMany({
    where: PENDING_PARCEL_WHERE,
    select: PENDING_PARCEL_SELECT,
    orderBy: { createdAt: 'asc' },
    take: PICKUP_MAX_SHIPMENTS,
  })
}

/** 台北時間的今天，yyyyMMdd。 */
export function pickupDateToday(now: Date = new Date()): string {
  return formatTcatDate(now)
}

/** 今天叫過車了沒。回 null 代表還沒（或叫失敗了，那種可以重叫）。 */
export async function todayPickupCall(now: Date = new Date()): Promise<TcatPickupCall | null> {
  return db.tcatPickupCall.findUnique({ where: { succeededDate: pickupDateToday(now) } })
}

export interface CallPickupInput {
  /** 這一趟要收的黑貓單（Shipment.id），必須都還在待交寄清單裡 */
  shipmentIds: string[]
  /**
   * 不在網站上的包裹件數 —— 例如直接在黑貓系統開的單。
   * 司機收幾件由總件數決定，這些件數沒有單號可以綁。
   */
  extraParcels?: number
  memo?: string
  requestedById?: string
}

export async function callTcatPickup(input: CallPickupInput): Promise<TcatPickupCall> {
  const callDate = pickupDateToday()
  const shipmentIds = [...new Set(input.shipmentIds)]
  const extraParcels = input.extraParcels ?? 0

  if (shipmentIds.length > PICKUP_MAX_SHIPMENTS) {
    throw new Error(`一次最多指定 ${PICKUP_MAX_SHIPMENTS} 張訂單`)
  }
  if (!Number.isInteger(extraParcels) || extraParcels < 0) {
    throw new Error('其他包裹件數必須是 0 以上的整數')
  }

  const shipments =
    shipmentIds.length > 0
      ? await db.shipment.findMany({
          where: { id: { in: shipmentIds }, ...PENDING_PARCEL_WHERE },
          select: { id: true, shipmentNo: true },
          orderBy: { createdAt: 'asc' },
        })
      : []

  // 畫面開著的期間，單可能已經被收走或排進別趟 —— 不要默默少叫幾件
  if (shipments.length !== shipmentIds.length) {
    throw new Error(
      `選取的訂單中有 ${shipmentIds.length - shipments.length} 張已經不在待交寄清單（可能已被收走或排入收貨），請重新整理後再選`,
    )
  }

  const quantity = shipments.length + extraParcels
  const memo = composePickupMemo(
    input.memo,
    shipments.map((s) => s.shipmentNo!),
    extraParcels,
  )

  // 電文先組起來，資料不合規就不要去佔今天的名額
  const request = buildPickupCall({
    customerName: senderConfig.name,
    contactName: tcatPickupConfig.contactName || senderConfig.name,
    contactGender: tcatPickupConfig.contactGender,
    contactTel: senderConfig.phone,
    contactMobile: senderConfig.cellphone,
    contactAddress: senderConfig.address,
    quantity,
    isContact: tcatPickupConfig.isContact,
    isTrolley: tcatPickupConfig.isTrolley,
    memo,
  })

  // 先佔位再打 API：唯一鍵擋掉「兩個管理員同時按」與「今天已經叫過了」。
  let record: TcatPickupCall
  try {
    record = await db.tcatPickupCall.create({
      data: {
        callDate,
        succeededDate: callDate,
        quantity,
        memo: request.Memo || null,
        requestedById: input.requestedById ?? null,
      },
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new Error('今天已經呼叫過黑貓了，黑貓每個收貨點一天只受理一次。有急件請直接電洽 412-8888。')
    }
    throw error
  }

  try {
    const result = await callPickup(request)
    const [call] = await db.$transaction([
      db.tcatPickupCall.update({
        where: { id: record.id },
        data: { srvTranId: result.srvTranId, message: result.message.slice(0, 500) },
      }),
      // pickupCallId: null 再擋一次：兩個分頁同時勾了同一張時，單只會掛在一趟上
      db.shipment.updateMany({
        where: { id: { in: shipments.map((s) => s.id) }, pickupCallId: null },
        data: { pickupCallId: record.id },
      }),
    ])
    return call
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)

    // 把今天的名額讓出來讓人可以重試。這裡跟 PrintOBT 的取捨相反：
    // 逾時而通知其實已送出時，重打最多是黑貓回「今日已呼叫過」把我們擋下來，
    // 代價遠小於「以為叫了車、其實沒叫，包裹整天躺在倉庫」。
    await db.tcatPickupCall.update({
      where: { id: record.id },
      data: { succeededDate: null, message: reason.slice(0, 500) },
    })

    throw new Error(`呼叫黑貓失敗：${reason}。若是連線逾時，集貨通知有可能已經送出，重按前請先確認。`)
  }
}

export const PICKUP_HISTORY_SELECT = {
  id: true,
  callDate: true,
  succeededDate: true,
  quantity: true,
  memo: true,
  message: true,
  createdAt: true,
  requestedBy: { select: { name: true, email: true } },
  shipments: {
    select: {
      id: true,
      shipmentNo: true,
      status: true,
      order: { select: { id: true, orderNo: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.TcatPickupCallSelect

export type PickupHistoryEntry = Prisma.TcatPickupCallGetPayload<{
  select: typeof PICKUP_HISTORY_SELECT
}>

/** 最近幾次叫車（含失敗的嘗試），後台用來對「哪天收了哪幾張」。 */
export async function listRecentPickupCalls(limit = 14): Promise<PickupHistoryEntry[]> {
  return db.tcatPickupCall.findMany({
    select: PICKUP_HISTORY_SELECT,
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}
