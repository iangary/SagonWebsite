import Script from 'next/script'
import { env } from '@/lib/env'

/**
 * GA4 追蹤碼。沒設定 GA_MEASUREMENT_ID 就整個不輸出。
 *
 * 刻意**不用** NEXT_PUBLIC_ 前綴。Next 會在「建置時」把 NEXT_PUBLIC_* 直接
 * 內聯進前端 bundle，而這個專案的 image 是在 CI 建的、當下讀不到正式站的
 * 環境變數 —— 加了前綴反而會把空字串烤進 image，之後在主機上怎麼設都沒用。
 *
 * 這是 Server Component，量測 ID 在「請求時」於伺服器端讀出來再寫進 HTML，
 * 所以改了 .env.production 後只要 `--force-recreate web` 就會生效。
 */
export function GoogleAnalytics() {
  const id = env.GA_MEASUREMENT_ID
  if (!id) return null

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${id}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${id}');
        `}
      </Script>
    </>
  )
}
