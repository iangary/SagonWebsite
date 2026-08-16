'use client'

import { useLocale } from 'next-intl'
import { useSession } from 'next-auth/react'
import { useTransition } from 'react'
import { usePathname, useRouter, type Locale } from '@/i18n/routing'
import { saveLocalePreference } from './locale-actions'

/** 下拉與抽屜共用同一組顯示名稱，免得兩邊漂移。 */
export const LOCALE_LABELS: Record<Locale, string> = {
  'zh-TW': '繁體中文',
  en: 'English',
}

/**
 * 切換語系。桌機的地球下拉（locale-switcher）與手機的漢堡抽屜（mobile-nav）共用。
 *
 * 三件事一起做：
 *  - router.replace：next-intl 會順手把 NEXT_LOCALE cookie 寫掉，畫面立刻換語言
 *  - saveLocalePreference：存到 users.locale，換裝置也留著（訪客會直接 no-op）
 *  - update：把新語系推進 JWT，proxy 之後才補得回正確的 cookie
 *
 * 後兩者刻意 fire-and-forget —— 失敗頂多是這台裝置以外沒同步到，
 * 不該讓畫面卡在那裡等一趟寫入。
 */
export function useLocaleSwitch() {
  const locale = useLocale() as Locale
  const pathname = usePathname()
  const router = useRouter()
  const { update } = useSession()
  const [pending, startTransition] = useTransition()

  function switchTo(next: Locale) {
    if (next === locale) return
    startTransition(() => {
      // usePathname 回傳的是去掉語系前綴的路徑，交給 router 補上新語系
      router.replace(pathname, { locale: next })
      void saveLocalePreference(next)
      void update({ locale: next })
    })
  }

  return { locale, pending, switchTo }
}
