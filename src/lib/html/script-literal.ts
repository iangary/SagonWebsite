/**
 * 把值序列化成可以安全放進 inline `<script>` 的 JS 字面量。
 *
 * JSON.stringify 不會跳脫 `</script>`。綠界電子地圖回呼（api/ecpay/logistics/map-reply）
 * 不驗簽、不需登入，欄位全是請求帶來的 —— 外站用一個自動送出的表單塞
 * `ExtraData=</script><script>…` 就能在本站網域執行腳本（受害者若是管理員，
 * 就能拿他的身分呼叫後台 Server Action）。
 *
 * `<`、`>`、`&` 與 U+2028／U+2029 一律換成 \uXXXX：JS 讀到的值不變，
 * HTML 解析器卻看不到任何標籤。
 */
const LINE_SEPARATORS = String.fromCharCode(0x2028, 0x2029)
const UNSAFE_IN_SCRIPT = new RegExp(`[<>&${LINE_SEPARATORS}]`, 'g')

export function toScriptLiteral(value: unknown): string {
  return JSON.stringify(value).replace(
    UNSAFE_IN_SCRIPT,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
}
