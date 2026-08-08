'use client'

import { Package, MapPin, User, Shield } from 'lucide-react'
import { Link, usePathname } from '@/i18n/routing'
import { cn } from '@/lib/utils'

export function AccountNav({
  labels,
}: {
  labels: { orders: string; addresses: string; profile: string; security: string }
}) {
  const pathname = usePathname()

  const links = [
    { href: '/account/orders', label: labels.orders, icon: Package },
    { href: '/account/addresses', label: labels.addresses, icon: MapPin },
    { href: '/account/profile', label: labels.profile, icon: User },
    { href: '/account/security', label: labels.security, icon: Shield },
  ]

  return (
    <nav className="lg:w-48 lg:shrink-0">
      <ul className="no-scrollbar -mx-6 flex gap-1 overflow-x-auto px-6 lg:mx-0 lg:block lg:space-y-1 lg:px-0">
        {links.map((link) => {
          const active = pathname === link.href || pathname.startsWith(`${link.href}/`)
          return (
            <li key={link.href} className="shrink-0">
              <Link
                href={link.href}
                className={cn(
                  'flex items-center gap-2.5 whitespace-nowrap px-4 py-2.5 text-sm transition-colors',
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
