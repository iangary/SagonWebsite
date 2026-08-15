/**
 * 第三方登入的 provider 清單。
 *
 * 這個模組刻意不掛 `server-only` —— 登入頁的按鈕是 client component，
 * 需要共用同一組 id 與型別。真正的憑證判斷在 src/lib/env.ts。
 */
/** 陣列順序 = 登入頁按鈕由上到下的順序。 */
export const SSO_PROVIDER_IDS = ['google', 'line', 'facebook'] as const

export type SsoProviderId = (typeof SSO_PROVIDER_IDS)[number]

/** 品牌名不翻譯，兩種語系都長一樣，所以放這裡而不是 messages。 */
export const SSO_PROVIDER_LABELS: Record<SsoProviderId, string> = {
  google: 'Google',
  line: 'LINE',
  facebook: 'Facebook',
}
