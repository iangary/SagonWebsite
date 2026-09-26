'use client'

import * as React from 'react'
import { Package, MapPin, User, Shield } from 'lucide-react'
import { Link, usePathname } from '@/i18n/routing'
import { cn } from '@/lib/utils'

export function AccountNav({
  labels,
}: {
  labels: { orders: string; addresses: string; profile: string; security: string }
}) {
  const pathname = usePathname()
  const listRef = React.useRef<HTMLUListElement>(null)
  const activeRef = React.useRef<HTMLLIElement>(null)

  const links = [
    { href: '/account/orders', label: labels.orders, icon: Package },
    { href: '/account/addresses', label: labels.addresses, icon: MapPin },
    { href: '/account/profile', label: labels.profile, icon: User },
    { href: '/account/security', label: labels.security, icon: Shield },
  ]

  /**
   * 手機版是橫向捲軸，四個分頁塞不進 375px。直接進 /account/security 時
   * 「帳號安全」會落在畫面外，只露出右邊一小條黑色，看起來像破版而不是可以捲。
   * 桌機版是直向清單、不會溢出，rect 比對自然不動它。
   */
  React.useEffect(() => {
    const list = listRef.current
    const item = activeRef.current
    if (!list || !item) return

    const listBox = list.getBoundingClientRect()
    const itemBox = item.getBoundingClientRect()
    // 多留 16px，捲到定位後不要整個貼在邊緣
    if (itemBox.right > listBox.right) list.scrollLeft += itemBox.right - listBox.right + 16
    else if (itemBox.left < listBox.left) list.scrollLeft -= listBox.left - itemBox.left + 16
  }, [pathname])

  return (
    <nav className="lg:w-48 lg:shrink-0">
      <ul
        ref={listRef}
        className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:block lg:space-y-1 lg:px-0"
      >
        {links.map((link) => {
          const active = pathname === link.href || pathname.startsWith(`${link.href}/`)
          return (
            <li key={link.href} ref={active ? activeRef : undefined} className="shrink-0">
              <Link
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2.5 whitespace-nowrap px-4 py-3 text-sm transition-colors lg:py-2.5',
                  active ? 'bg-ink-900 text-cream-50' : 'text-ink-700 hover:bg-cream-100',
                )}
              >
                <link.icon size={15} strokeWidth={1.5} />
                {link.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
