'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import * as Dialog from '@radix-ui/react-dialog'
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
  Undo2,
  Settings,
  LogOut,
  Menu,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const LINKS = [
  { href: '/admin', label: '總覽', icon: LayoutDashboard, exact: true },
  { href: '/admin/orders', label: '訂單', icon: ShoppingCart },
  { href: '/admin/refunds', label: '退款', icon: Undo2 },
  { href: '/admin/chat', label: '客服訊息', icon: MessagesSquare, badge: 'chat' as const },
  { href: '/admin/products', label: '商品', icon: Package },
  { href: '/admin/taxonomy', label: '分類與品牌', icon: FolderTree },
  { href: '/admin/coupons', label: '優惠券', icon: Tag },
  { href: '/admin/reviews', label: '評論', icon: Star },
  { href: '/admin/members', label: '會員', icon: Users },
  { href: '/admin/webhooks', label: 'Webhook', icon: Webhook },
  { href: '/admin/settings', label: '商店設定', icon: Settings },
]

function isActive(pathname: string, link: (typeof LINKS)[number]) {
  return link.exact ? pathname === link.href : pathname.startsWith(link.href)
}

/**
 * chatUnread 由 layout 在每次導覽時算好傳進來。
 * 沒有做即時推播 —— 後台側邊欄的紅點差幾秒無所謂，不值得為它多開一條長連線。
 *
 * 兩種版型共用同一份 LINKS 與 NavBody：
 * lg 以上是常駐側邊欄，以下收成頂端列 + 抽屜 —— 208px 的側邊欄在手機上會吃掉半個螢幕。
 */
export function AdminNav({ userName, chatUnread }: { userName: string; chatUnread: number }) {
  const pathname = usePathname()

  // 記「在哪一頁打開的」而不是單純的 boolean：換頁時 open 自然變回 false，
  // 不必再用 effect 去 setState（上一頁／下一頁也一樣會收起來）。
  const [openedAt, setOpenedAt] = React.useState<string | null>(null)
  const open = openedAt === pathname
  const setOpen = (next: boolean) => setOpenedAt(next ? pathname : null)

  const current = LINKS.find((link) => isActive(pathname, link))

  return (
    <>
      <header className="sticky top-0 z-50 flex items-center gap-1 border-b border-cream-200 bg-cream-100 px-2 lg:hidden">
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Trigger
            aria-label="開啟後台選單"
            className="relative flex size-11 shrink-0 items-center justify-center text-ink-900"
          >
            <Menu size={20} strokeWidth={1.5} />
            {/* 抽屜關著的時候看不到客服的紅點，所以漢堡上留一個小點 */}
            {chatUnread > 0 && (
              <span className="absolute right-2.5 top-2.5 size-2 rounded-full bg-sale" />
            )}
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-70 bg-ink-900/30 backdrop-blur-sm" />
            <Dialog.Content
              aria-describedby={undefined}
              className="fixed inset-y-0 left-0 z-80 flex w-[85vw] max-w-xs flex-col bg-cream-100 shadow-xl"
            >
              <div className="flex items-start justify-between border-b border-cream-200 px-5 py-4">
                <div className="min-w-0">
                  <Dialog.Title className="text-sm tracking-[0.15em] text-ink-900">
                    莎岡管理後台
                  </Dialog.Title>
                  <p className="mt-1 truncate text-xs text-taupe-500">{userName}</p>
                </div>
                <Dialog.Close
                  aria-label="關閉選單"
                  className="-mr-2 -mt-1.5 flex size-10 shrink-0 items-center justify-center text-taupe-500 hover:text-ink-900"
                >
                  <X size={18} strokeWidth={1.5} />
                </Dialog.Close>
              </div>
              <NavBody
                pathname={pathname}
                chatUnread={chatUnread}
                onNavigate={() => setOpen(false)}
                touch
              />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <p className="truncate text-sm tracking-[0.1em] text-ink-900">
          {current?.label ?? '管理後台'}
        </p>
      </header>

      <nav className="sticky top-0 hidden h-screen w-52 shrink-0 flex-col border-r border-cream-200 bg-cream-100 lg:flex">
        <div className="border-b border-cream-200 px-5 py-5">
          <p className="text-sm tracking-[0.15em] text-ink-900">莎岡管理後台</p>
          <p className="mt-1 truncate text-xs text-taupe-500">{userName}</p>
        </div>
        <NavBody pathname={pathname} chatUnread={chatUnread} />
      </nav>
    </>
  )
}

/** 連結清單與頁尾動作。touch 讓抽屜裡的每一列都到 44px，桌機維持原本的密度。 */
function NavBody({
  pathname,
  chatUnread,
  onNavigate,
  touch,
}: {
  pathname: string
  chatUnread: number
  onNavigate?: () => void
  touch?: boolean
}) {
  const row = cn(
    'flex items-center gap-3 px-5 text-sm transition-colors',
    touch ? 'min-h-11 py-3' : 'py-2.5',
  )

  return (
    <>
      <ul className="flex-1 overflow-y-auto py-2">
        {LINKS.map((link) => {
          const active = isActive(pathname, link)
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  row,
                  active ? 'bg-ink-900 text-cream-50' : 'text-ink-700 hover:bg-cream-200',
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
        <a href="/" className={cn(row, 'text-ink-700 hover:bg-cream-200')}>
          <Store size={16} strokeWidth={1.5} />
          回到前台
        </a>
        <button
          onClick={() => signOut({ redirectTo: '/' })}
          className={cn(row, 'w-full text-ink-700 hover:bg-cream-200')}
        >
          <LogOut size={16} strokeWidth={1.5} />
          登出
        </button>
      </div>
    </>
  )
}
