import { defineRouting } from 'next-intl/routing'
import { createNavigation } from 'next-intl/navigation'
import { locales, defaultLocale, type Locale } from './config'

export { locales, type Locale }

export const routing = defineRouting({
  locales,
  defaultLocale,
  /**
   * 兩個語系共用同一組網址，語言記在 NEXT_LOCALE cookie。
   *
   * 這代表 /about 可能是中文也可能是英文，取決於訪客的 cookie；
   * 分享出去的連結不會帶語言，對方看到的是他自己的語系。
   *
   * 改成 never 而不是 as-needed，是因為英文版本來就沒有被獨立收錄的價值 ——
   * 全站頁面的 canonical 一直都寫死無前綴網址（見各 page 的 generateMetadata），
   * /en/about 等於自己宣告是 /about 的重複頁。留著 /en 只是多一組進不了索引的網址。
   *
   * 既有的 /en/* 連結由 next-intl 自動 307 到無前綴網址，不會死掉。
   */
  localePrefix: 'never',

  /**
   * next-intl 的預設 cookie 沒有 maxAge，是關掉瀏覽器就消失的 session cookie。
   * 語系既然只剩 cookie 這一個載體，那等於每次重開瀏覽器都退回 Accept-Language 判斷 ——
   * 手機的分頁被系統回收得更兇，體感就是「選了英文，過一下又變回中文」。
   *
   * 登入的會員另外把語系存在 users.locale，由 proxy 從 JWT 補回 cookie；
   * 但訪客只有這個 cookie，所以 maxAge 不能省。
   */
  localeCookie: { maxAge: 60 * 60 * 24 * 365 },
})

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing)
