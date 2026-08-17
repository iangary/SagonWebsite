import 'server-only'
import { Prisma, type TcatPickupCall } from '@prisma/client'
import { db } from '@/lib/db'
import { senderConfig } from '@/lib/ecpay/config'
import { callPickup } from '@/lib/tcat/client'
import { tcatPickupConfig } from '@/lib/tcat/config'
import { formatTcatDate } from '@/lib/tcat/fields'
import { buildPickupCall } from '@/lib/tcat/pickup'

/**
 * 呼叫黑貓來收貨（規格 2.6）。
 *
 * 這是倉庫層級的動作，不是每張訂單各叫一次 —— 規格限制「每個收貨點每日僅能使用一次」，
 * 且無法預約時段，司機依當日路線過來。所以：
 *   - 只由後台按鈕觸發（包好了沒只有現場的人知道，排程猜不準）
 *   - 不進 BullMQ（會自動重試的東西碰這支 API 就是叫兩台車）
 *   - 用 TcatPickupCall 當每日一次的鎖
 */

/** 待交寄的包裹數：託運單已成立、但貨態還沒進到集貨的黑貓單。 */
export async function pendingTcatParcelCount(): Promise<number> {
  return db.shipment.count({
    where: {
      logisticsSubType: 'TCAT',
      shipmentNo: { not: null },
      // CREATED = 已配號還在我們手上；一旦進 IN_TRANSIT 就代表司機收走了
      status: 'CREATED',
    },
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
  /** 要收幾件。呼叫端沒給就用 pendingTcatParcelCount() */
  quantity?: number
  memo?: string
  requestedById?: string
}

export async function callTcatPickup(input: CallPickupInput = {}): Promise<TcatPickupCall> {
  const callDate = pickupDateToday()
  const quantity = input.quantity ?? (await pendingTcatParcelCount())

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
    memo: input.memo,
  })

  // 先佔位再打 API：唯一鍵擋掉「兩個管理員同時按」與「今天已經叫過了」。
  let record: TcatPickupCall
  try {
    record = await db.tcatPickupCall.create({
      data: {
        callDate,
        succeededDate: callDate,
        quantity,
        memo: input.memo?.slice(0, 100) || null,
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
    return db.tcatPickupCall.update({
      where: { id: record.id },
      data: { srvTranId: result.srvTranId, message: result.message.slice(0, 500) },
    })
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
