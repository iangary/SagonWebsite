/**
 * 「只有會員能結帳」這條規則的共用常數。
 *
 * 訪客可以瀏覽、加購物車、用訂單編號查訂單，但**結帳需要會員帳號**
 * （決策見 SPEC.md §5.2）。把導向網址集中在這裡，購物車頁的按鈕、結帳頁的
 * 守門與登入／註冊頁的提示條才不會各自寫死一組對不上的路徑。
 *
 * 這支檔案不 import server-only 的東西 —— 購物車頁的 client component 也要用。
 */

/** 結帳頁本身的路徑，登入或註冊完成後要回到這裡 */
export const CHECKOUT_PATH = '/checkout'

/** 訪客按結帳時去的地方：先註冊（註冊頁本身有「已有帳號 → 登入」的出口） */
export const CHECKOUT_REGISTER_HREF = `/register?callbackUrl=${encodeURIComponent(CHECKOUT_PATH)}`

/** 已經有帳號的人的捷徑 */
export const CHECKOUT_LOGIN_HREF = `/login?callbackUrl=${encodeURIComponent(CHECKOUT_PATH)}`

/** 結帳頁擋下訪客時 redirect() 的目標 */
export const CHECKOUT_LOGIN_REDIRECT = CHECKOUT_REGISTER_HREF

/**
 * callbackUrl 是不是指回結帳流程 —— 登入／註冊頁靠它決定要不要顯示
 * 「結帳前請先登入」的提示條。只認站內相對路徑，避免被塞外部網址。
 */
export function isCheckoutCallback(callbackUrl: string | undefined): boolean {
  if (!callbackUrl) return false
  return callbackUrl === CHECKOUT_PATH || callbackUrl.startsWith(`${CHECKOUT_PATH}?`)
}
