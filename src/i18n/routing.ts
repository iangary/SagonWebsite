import { defineRouting } from 'next-intl/routing'
import { createNavigation } from 'next-intl/navigation'
import { locales, defaultLocale, type Locale } from './config'

export { locales, type Locale }

export const routing = defineRouting({
  locales,
  defaultLocale,
  // 預設語系不加前綴：/ 是繁中，/en 是英文
  localePrefix: 'as-needed',
})

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing)
