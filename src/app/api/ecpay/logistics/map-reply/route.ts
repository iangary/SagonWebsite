import { type NextRequest } from 'next/server'
import { env } from '@/lib/env'
import { parseMapReply } from '@/lib/ecpay/logistics'
import { readCallbackParams, recordWebhook, markWebhookProcessed } from '@/lib/ecpay/webhook'

export const dynamic = 'force-dynamic'

/**
 * 綠界電子地圖選完門市後，會把消費者的瀏覽器 POST 回這裡。
 *
 * 這支沒有 CheckMacValue 可驗（綠界電子地圖不簽章），所以門市資料
 * 只當作「使用者輸入」看待 —— 真正建立物流訂單時綠界會再驗一次門市代號是否存在。
 *
 * 回傳一頁把結果 postMessage 給開啟它的結帳頁，然後自己關掉。
 */
export async function POST(req: NextRequest) {
  const params = await readCallbackParams(req)
  const selection = parseMapReply(params)

  // 留一份紀錄，日後查「使用者到底選了哪間店」時有依據
  const event = await recordWebhook('logistics_map', params, false)
  await markWebhookProcessed(event.id)

  const payload = JSON.stringify({
    type: 'ecpay:cvs-store-selected',
    store: selection,
    // 結帳頁開地圖時產生的一次性 token（經 ExtraData 原樣繞回來），
    // 結帳頁會比對它，擋掉不是自己開的視窗回傳的門市資料
    token: params.ExtraData ?? '',
  })

  const origin = new URL(env.APP_URL).origin

  const html = `<!doctype html>
<html lang="zh-TW">
<head>
  <meta charset="utf-8">
  <meta name="robots" content="noindex">
  <title>已選擇門市</title>
  <style>
    body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
           background:#faf8f5; color:#2b2724; font-family:system-ui,"Microsoft JhengHei",sans-serif; }
    p { font-size:14px; }
  </style>
</head>
<body>
  <p id="msg">已選擇門市，正在返回結帳頁…</p>
  <script>
    (function () {
      var payload = ${payload};
      try {
        if (window.opener && !window.opener.closed) {
          // 指定 targetOrigin，不要用 '*'，避免門市資料被其他分頁讀走
          window.opener.postMessage(payload, ${JSON.stringify(origin)});
          window.close();
          return;
        }
      } catch (e) { /* 跨視窗存取被擋，改用下面的 fallback */ }

      // 沒有 opener（例如手機上被當成同一個分頁開啟）就把結果塞進 sessionStorage 再導回
      try { sessionStorage.setItem('ecpay:cvs-store', JSON.stringify({ store: payload.store, token: payload.token })); } catch (e) {}
      location.replace('/checkout');
    })();
  </script>
</body>
</html>`

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
