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

/**
 * Auth.js 登入／綁定失敗時導回頁面帶的 `?error=<code>` → messages 的 `auth.*` key。
 *
 * 代碼值域見 node_modules/@auth/core/errors.js 的 clientErrors。
 * 不在表裡的（Configuration、AccessDenied…）一律收成 loginFailed ——
 * 對客人講內部原因沒有意義，而且那些代碼是設定錯誤、不是他能處理的事。
 */
const SIGN_IN_ERROR_KEYS: Record<string, 'invalidCredentials' | 'ssoAccountTaken'> = {
  CredentialsSignin: 'invalidCredentials',
  /** 已登入的會員綁第二組 SSO，而那個第三方帳號已經屬於別的會員。 */
  OAuthAccountNotLinked: 'ssoAccountTaken',
  /** 沒開 allowDangerousEmailAccountLinking 的 provider 撞到同 email 時是這個代碼。 */
  AccountNotLinked: 'ssoAccountTaken',
}

export type SignInErrorKey = 'invalidCredentials' | 'ssoAccountTaken' | 'loginFailed'

/** 登入頁與帳號安全頁共用同一份對照，訊息才不會兩邊各講一套。 */
export function signInErrorKey(code: string | null | undefined): SignInErrorKey {
  if (!code) return 'loginFailed'
  return SIGN_IN_ERROR_KEYS[code] ?? 'loginFailed'
}
