'use client'

import { useLocale } from 'next-intl'
import { useTransition } from 'react'
import { Globe } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { usePathname, useRouter, locales, type Locale } from '@/i18n/routing'
import { cn } from '@/lib/utils'

const LABELS: Record<Locale, string> = {
  'zh-TW': '繁體中文',
  en: 'English',
}

export function LocaleSwitcher({ label }: { label: string }) {
  const locale = useLocale() as Locale
  const pathname = usePathname()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function switchTo(next: Locale) {
    if (next === locale) return
    startTransition(() => {
      // usePathname 回傳的是去掉語系前綴的路徑，交給 router 補上新語系
      router.replace(pathname, { locale: next })
    })
  }

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
              {LABELS[l]}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
