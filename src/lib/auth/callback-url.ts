/**
 * 登入／註冊完成後要導去的 callbackUrl，只接受站內路徑。
 *
 * 光看 `startsWith('/')` 不夠：`//evil.example` 與 `/\evil.example` 也是斜線開頭，
 * 但瀏覽器會把它們當成「協定相對網址」解析成外站 —— 登入完就被送到釣魚頁，
 * 而使用者剛剛才在我們的網域上輸入過密碼，最容易相信下一頁。
 *
 * 不掛 server-only：登入頁的 client component 也可能用到。
 */
export function safeCallbackUrl(raw: string | null | undefined): string | undefined {
  if (!raw || !raw.startsWith('/')) return undefined
  // 第二個字元是 / 或 \ 就是協定相對網址；控制字元（例如 /%09/evil）瀏覽器會先剝掉再解析
  if (raw[1] === '/' || raw[1] === '\\') return undefined
  if (/[\u0000-\u001f\u007f]/.test(raw)) return undefined
  return raw
}
