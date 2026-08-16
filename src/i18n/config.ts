/**
 * 語系清單與預設語系。
 *
 * 刻意跟 routing.ts 分開：routing.ts 會呼叫 createNavigation，那條路徑會拉進
 * next/navigation。純伺服器端的模組（shop-config、lib/i18n/localized）只需要
 * 知道「預設語系是哪個」，不該為了一個字串把整包 client navigation 拖進來。
 */
export const locales = ['zh-TW', 'en'] as const
export type Locale = (typeof locales)[number]

export const defaultLocale: Locale = 'zh-TW'

/**
 * 把來路不明的字串收斂成 Locale。
 *
 * 會員的 users.locale 在資料庫裡是 TEXT（不是 enum，見 schema 的註解），
 * 讀回來是 string；不認得的值一律當成「沒選過」回 null，讓後續照 Accept-Language 走。
 */
export function toLocale(value: string | null | undefined): Locale | null {
  return locales.includes(value as Locale) ? (value as Locale) : null
}
