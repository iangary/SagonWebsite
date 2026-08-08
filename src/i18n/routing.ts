import { defineRouting } from 'next-intl/routing'
import { createNavigation } from 'next-intl/navigation'

export const locales = ['zh-TW', 'en'] as const
export type Locale = (typeof locales)[number]

export const routing = defineRouting({
  locales,
  defaultLocale: 'zh-TW',
  // 預設語系不加前綴：/ 是繁中，/en 是英文
  localePrefix: 'as-needed',
})

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing)
