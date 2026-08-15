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
