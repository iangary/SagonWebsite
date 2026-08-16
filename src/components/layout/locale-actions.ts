'use server'

import { db } from '@/lib/db'
import { currentUser } from '@/lib/auth'
import { toLocale } from '@/i18n/config'

/**
 * 把語系記到會員身上。
 *
 * cookie 由 next-intl 自己寫（見 i18n/routing.ts 的 localeCookie），這裡只負責
 * 讓選擇跨裝置、跨瀏覽器活下來 —— cookie 掉了之後由 proxy 從 JWT 讀回來補上。
 *
 * 用 currentUser() 而不是 requireUser()：訪客切語言是完全正常的操作，
 * 不該丟 UNAUTHENTICATED。沒登入就什麼都不做，cookie 那條路照樣生效。
 */
export async function saveLocalePreference(value: string) {
  const locale = toLocale(value)
  if (!locale) return

  const user = await currentUser()
  if (!user) return

  await db.user.update({ where: { id: user.id }, data: { locale } })
}
