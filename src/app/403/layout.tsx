import '@/styles/globals.css'

/**
 * /403 自己的根 layout。
 *
 * 專案沒有 app/layout.tsx（[locale] 與 admin 各自是 root layout），/403 原本靠 Next 內建的
 * DefaultLayout 提供 html/body；Next 16.4 起建置時要求每個頁面都有 root layout，少了這支
 * `next build` 會失敗（「403/page.tsx doesn't have a root layout」）。
 *
 * 只在 /403 用到（非管理員進 /admin 時由 proxy.ts rewrite、或 admin layout redirect 過來），
 * 這頁只有中文，所以 lang 固定 zh-TW。
 */
export default function ForbiddenLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW">
      <body>{children}</body>
    </html>
  )
}
