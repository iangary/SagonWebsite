import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { auth, isDbAdmin } from '@/lib/auth'
import { countConversationsAwaitingAgent } from '@/lib/chat'
import { AdminNav } from './admin-nav'
import { ToastProvider } from '@/components/ui/toast'
import '@/styles/globals.css'

export const metadata: Metadata = {
  title: { default: '管理後台', template: '%s｜管理後台' },
  robots: { index: false, follow: false },
}

/**
 * 後台不做多語系，所以放在 [locale] 之外，需要自己的 html/body。
 * proxy.ts 已經擋過一次權限，這裡再擋一次 —— 免得日後改到 matcher 就整個開天窗。
 *
 * 這一關才是權威的那個：proxy 與 session 都只看 JWT，而 token 上的 role 最多會舊
 * 5 分鐘（見 lib/auth 的 jwt callback）。剛被移除權限的人 token 還是 ADMIN，
 * 所以這裡直接問資料庫，讓撤權當下就把人擋在門外。
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect('/login?callbackUrl=/admin')
  if (session.user.role !== 'ADMIN') redirect('/403')
  if (!(await isDbAdmin(session.user.id))) redirect('/403')

  const chatUnread = await countConversationsAwaitingAgent()

  return (
    <html lang="zh-TW">
      <body className="min-h-screen bg-cream-50">
        <ToastProvider>
          {/* 手機是「頂端列在上、內容在下」的直排，lg 以上才切成側邊欄 + 內容的橫排 */}
          <div className="min-h-screen lg:flex">
            <AdminNav
              userName={session.user.name ?? session.user.email ?? '管理員'}
              chatUnread={chatUnread}
            />
            <div className="min-w-0 flex-1">
              <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
            </div>
          </div>
        </ToastProvider>
      </body>
    </html>
  )
}
