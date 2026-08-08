import 'server-only'

/** HTML 屬性值的跳脫，避免參數內容把 value="" 提早關掉造成注入 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 綠界的收銀台與電子地圖都只吃 form POST，不能用 fetch 或 redirect 帶參數。
 * 所以回一頁自動送出的表單，使用者會看到極短暫的轉場畫面。
 */
export function renderAutoSubmitForm({
  action,
  params,
  title = '正在前往綠界…',
  message = '正在為您導向綠界，請稍候…',
}: {
  action: string
  params: Record<string, string>
  title?: string
  message?: string
}): Response {
  const inputs = Object.entries(params)
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`)
    .join('\n    ')

  const html = `<!doctype html>
<html lang="zh-TW">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
           background:#faf8f5; color:#2b2724; font-family:system-ui,-apple-system,"Microsoft JhengHei",sans-serif; }
    .box { text-align:center; }
    .spinner { width:32px; height:32px; margin:0 auto 20px; border:2px solid #e9e2d8;
               border-top-color:#a08d7d; border-radius:50%; animation:spin .8s linear infinite; }
    @keyframes spin { to { transform:rotate(360deg); } }
    p { font-size:14px; letter-spacing:.05em; }
    button { margin-top:20px; padding:10px 22px; border:1px solid #2b2724; background:transparent;
             color:#2b2724; font-size:13px; cursor:pointer; }
    @media (prefers-reduced-motion: reduce) { .spinner { animation:none; } }
  </style>
</head>
<body>
  <div class="box">
    <div class="spinner" role="status" aria-label="載入中"></div>
    <p>${escapeHtml(message)}</p>
    <form id="ecpay-form" method="post" action="${escapeHtml(action)}">
    ${inputs}
      <noscript><button type="submit">繼續</button></noscript>
    </form>
  </div>
  <script>document.getElementById('ecpay-form').submit();</script>
</body>
</html>`

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // 這頁含有一次性的簽章，不能被快取
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  })
}
