'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import {
  LayoutDashboard,
  Package,
  FolderTree,
  ShoppingCart,
  Tag,
  Star,
  Users,
  Webhook,
  MessagesSquare,
  Store,
  LogOut,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const LINKS = [
  { href: '/admin', label: '總覽', icon: LayoutDashboard, exact: true },
  { href: '/admin/orders', label: '訂單', icon: ShoppingCart },
  { href: '/admin/chat', label: '客服訊息', icon: MessagesSquare, badge: 'chat' as const },
  { href: '/admin/products', label: '商品', icon: Package },
  { href: '/admin/taxonomy', label: '分類與品牌', icon: FolderTree },
  { href: '/admin/coupons', label: '優惠券', icon: Tag },
  { href: '/admin/reviews', label: '評論', icon: Star },
  { href: '/admin/members', label: '會員', icon: Users },
  { href: '/admin/webhooks', label: 'Webhook', icon: Webhook },
]

/**
 * chatUnread 由 layout 在每次導覽時算好傳進來。
 * 沒有做即時推播 —— 後台側邊欄的紅點差幾秒無所謂，不值得為它多開一條長連線。
 */
export function AdminNav({ userName, chatUnread }: { userName: string; chatUnread: number }) {
  const pathname = usePathname()

  return (
    <nav className="sticky top-0 flex h-screen w-52 shrink-0 flex-col border-r border-cream-200 bg-cream-100">
      <div className="border-b border-cream-200 px-5 py-5">
        <p className="text-sm tracking-[0.15em] text-ink-900">莎岡管理後台</p>
        <p className="mt-1 truncate text-xs text-taupe-500">{userName}</p>
      </div>

      <ul className="flex-1 overflow-y-auto py-2">
        {LINKS.map((link) => {
          const active = link.exact ? pathname === link.href : pathname.startsWith(link.href)
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                className={cn(
                  'flex items-center gap-3 px-5 py-2.5 text-sm transition-colors',
                  active
                    ? 'bg-ink-900 text-cream-50'
                    : 'text-ink-700 hover:bg-cream-200',
                )}
              >
                <link.icon size={16} strokeWidth={1.5} />
                <span className="flex-1">{link.label}</span>
                {link.badge === 'chat' && chatUnread > 0 && (
                  <span className="flex min-w-5 items-center justify-center rounded-full bg-sale px-1.5 text-[11px] text-white tabular-nums">
                    {chatUnread > 99 ? '99+' : chatUnread}
                  </span>
                )}
              </Link>
            </li>
          )
        })}
      </ul>

      <div className="border-t border-cream-200 py-2">
        <a
          href="/"
          className="flex items-center gap-3 px-5 py-2.5 text-sm text-ink-700 transition-colors hover:bg-cream-200"
        >
          <Store size={16} strokeWidth={1.5} />
          回到前台
        </a>
        <button
          onClick={() => signOut({ redirectTo: '/' })}
          className="flex w-full items-center gap-3 px-5 py-2.5 text-sm text-ink-700 transition-colors hover:bg-cream-200"
        >
          <LogOut size={16} strokeWidth={1.5} />
          登出
        </button>
      </div>
    </nav>
  )
}
