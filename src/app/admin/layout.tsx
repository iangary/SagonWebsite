import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
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
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect('/login?callbackUrl=/admin')
  if (session.user.role !== 'ADMIN') redirect('/403')

  return (
    <html lang="zh-TW">
      <body className="min-h-screen bg-cream-50">
        <ToastProvider>
          <div className="flex min-h-screen">
            <AdminNav userName={session.user.name ?? session.user.email ?? '管理員'} />
            <div className="min-w-0 flex-1">
              <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
            </div>
          </div>
        </ToastProvider>
      </body>
    </html>
  )
}
