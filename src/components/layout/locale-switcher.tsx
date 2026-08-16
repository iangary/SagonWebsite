'use client'

import { Globe } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { locales } from '@/i18n/routing'
import { cn } from '@/lib/utils'
import { LOCALE_LABELS, useLocaleSwitch } from './use-locale-switch'

/**
 * 桌機的語言切換。
 *
 * 640px 以下刻意不顯示：那個寬度的 header 已經是漢堡 + logo + 四顆圖示，
 * 搜尋框一展開就爆版。手機的入口在漢堡抽屜裡（見 mobile-nav.tsx）。
 */
export function LocaleSwitcher({ label }: { label: string }) {
  const { locale, pending, switchTo } = useLocaleSwitch()

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={label}
        disabled={pending}
        className="hidden size-10 items-center justify-center text-ink-700 transition-colors hover:text-taupe-600 disabled:opacity-50 sm:flex"
      >
        <Globe size={19} strokeWidth={1.5} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-60 min-w-36 border border-cream-200 bg-white py-1 text-sm shadow-lg"
        >
          {locales.map((l) => (
            <DropdownMenu.Item
              key={l}
              onSelect={() => switchTo(l)}
              className={cn(
                'cursor-pointer px-4 py-2.5 outline-none data-highlighted:bg-cream-100',
                l === locale ? 'text-ink-900' : 'text-taupe-500',
              )}
            >
              {LOCALE_LABELS[l]}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
