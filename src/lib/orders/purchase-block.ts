import 'server-only'
import { db } from '@/lib/db'

/**
 * 停止購買服務（FAQ「寄送方式」：拒收、逾期未取件達一次即停止後續購買）。
 *
 * 只由後台人工切換。綠界／黑貓回報的「退回」狀態分不出是客人拒收、逾期未取，
 * 還是店家自己安排的退貨，自動停權會誤傷人 —— 後台訂單頁看到退回時會提醒管理員評估。
 */
export async function isPurchaseBlocked(userId: string): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { purchaseBlockedAt: true },
  })
  return Boolean(user?.purchaseBlockedAt)
}
