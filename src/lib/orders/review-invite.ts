import 'server-only'
import { db } from '@/lib/db'
import { env } from '@/lib/env'

/**
 * 出貨完成一段時間後，邀請買家留下評論。
 *
 * 為什麼是排程掃描而不是在「訂單轉 COMPLETED 那一刻」排一個延遲工作：
 * 訂單有兩條路會變成 COMPLETED —— 黑貓回報已取貨（lib/orders/logistics.ts）
 * 與後台手動改狀態（admin/orders/actions.ts）。掃描式只要顧一個地方，
 * 而且 worker 停機期間錯過的訂單，下一輪會自動補上。
 *
 * 這是「做留言」唯一正確的做法：真的買過的人、真的評價。
 * Review 綁 orderItemId @unique，本來就只有買過的人寫得進來。
 */

/** 完成後隔幾天寄邀請信。太快寄客人還沒穿過，太慢就忘了。 */
export const REVIEW_INVITE_DELAY_DAYS = 7

/** 一輪最多寄幾封，避免一次灌爆 SMTP 而被判定為垃圾寄件 */
const BATCH_SIZE = 50

export async function findOrdersAwaitingReviewInvite(now = new Date()) {
  const cutoff = new Date(now.getTime() - REVIEW_INVITE_DELAY_DAYS * 24 * 60 * 60 * 1000)

  return db.order.findMany({
    where: {
      status: 'COMPLETED',
      completedAt: { not: null, lte: cutoff },
      reviewInviteSentAt: null,
      // 評論要綁會員帳號，訪客訂單沒有地方可以寫，寄了也只是打擾
      userId: { not: null },
      /*
       * 已經每一項都評過的訂單不用再邀。
       * `none` 而不是 `every`：只要還有任何一項沒評，就值得寄一封。
       */
      items: { some: { reviews: { none: {} } } },
    },
    select: { id: true },
    orderBy: { completedAt: 'asc' },
    take: BATCH_SIZE,
  })
}

/**
 * 標記為已寄送。
 *
 * 條件式更新（where 帶 reviewInviteSentAt: null）而不是直接寫入 ——
 * 排程萬一重疊執行，第二次會影響 0 列，不會重複寄信。
 * 回傳 false 代表這封已經被另一輪處理掉了，呼叫端應該跳過。
 */
export async function claimReviewInvite(orderId: string, now = new Date()): Promise<boolean> {
  const result = await db.order.updateMany({
    where: { id: orderId, reviewInviteSentAt: null },
    data: { reviewInviteSentAt: now },
  })
  return result.count === 1
}

/** 取消標記，讓下一輪重試（寄信失敗時用） */
export async function releaseReviewInvite(orderId: string): Promise<void> {
  await db.order.updateMany({
    where: { id: orderId },
    data: { reviewInviteSentAt: null },
  })
}

export function reviewPageUrl(orderId: string): string {
  return new URL(`/account/orders/${orderId}/review`, env.APP_URL).toString()
}
