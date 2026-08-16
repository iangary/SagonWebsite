import createIntlMiddleware from 'next-intl/middleware'
import { getToken } from 'next-auth/jwt'
import { NextResponse, type NextRequest } from 'next/server'
import { routing, locales } from '@/i18n/routing'

const intlMiddleware = createIntlMiddleware(routing)

/**
 * 這裡**故意不用 `auth()` 包住**，改成自己解 JWT。看起來繞路，但包起來會讓中文站整站掛掉：
 *
 * `.env.production` 有 `AUTH_URL`（`/api/auth/*` 的 OAuth callback 需要它，否則 Auth.js
 * 會從容器內部網址推導出 `https://0.0.0.0:3000/api/auth/callback/google` 而被 Google 拒絕）。
 * 而 next-auth 的 `auth()` 會先跑 `reqWithEnvURL()`，把進來的請求 origin 整個換成 `AUTH_URL`
 * 的值，再把這個「加工過的請求」交給我們的 callback（見 next-auth/lib/index.js 的
 * 「Execute user's middleware/handler with the augmented request」）。
 *
 * 一旦把它傳給 next-intl，`/` → `/zh-TW` 這道內部 rewrite 就會帶上公開網域。Next 判斷
 * rewrite 是不是內部的條件是 origin 要跟伺服器自己的完全相同（容器裡是 HOSTNAME=0.0.0.0），
 * 對不上就當成外部網址真的發請求出去，繞回 Caddy 後 proxy 再跑一次、這次看到 `/zh-TW`，
 * 而 `as-needed` 不准預設語系帶前綴 → 307 回 `/` → 無限轉址。2026-08-16 就是這樣掛的。
 * 英文站沒事，因為 `/en` 直接對得上 `app/[locale]`，不需要那道 rewrite。
 *
 * `getToken()` 只讀 cookie 解 JWT，不碰請求網址，next-intl 拿到的就是原始請求。
 * session 策略是 JWT（見 lib/auth/config.ts），role 由 jwt callback 釘在 token 上。
 */
async function readSession(req: NextRequest) {
  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET,
    // cookie 名稱與解密用的 salt 都由這個旗標決定：正式站走 https，Auth.js 發的是
    // `__Secure-authjs.session-token`；本機 http 是不帶前綴的版本。給錯會全站變成未登入。
    secureCookie: process.env.NODE_ENV === 'production',
  })
  // role 與 locale 的型別來自 src/types/next-auth.d.ts 對 JWT 的擴充，不用再轉型
  return { isLoggedIn: Boolean(token), role: token?.role, locale: token?.locale }
}

const LOCALE_COOKIE = 'NEXT_LOCALE'
const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/**
 * 會員在別台裝置選的語系，用 JWT 帶回來補上 NEXT_LOCALE。
 *
 * 順序很要緊：一定要在 intlMiddleware(req) **之前**改 req 上的 cookie。
 * next-intl 是讀請求裡的 cookie 決定這次要 render 哪個語系的，
 * 只寫 response 的話這次仍然是舊語系、下次才對，畫面會閃一下。
 */
function applyAccountLocale(req: NextRequest, locale: string | null | undefined) {
  if (!locale || req.cookies.get(LOCALE_COOKIE)?.value === locale) return null
  req.cookies.set(LOCALE_COOKIE, locale)
  return locale
}

const LOCALE_PREFIX = new RegExp(`^/(${locales.join('|')})(?=/|$)`)

/** 去掉語系前綴，讓 /en/account 與 /account 走同一套判斷。 */
function stripLocale(pathname: string): string {
  const stripped = pathname.replace(LOCALE_PREFIX, '')
  return stripped === '' ? '/' : stripped
}

/** 需要登入的前台路徑 */
const PROTECTED = [/^\/account(\/|$)/]

const CART_COOKIE = 'sagon_cart'
const CART_COOKIE_MAX_AGE = 60 * 60 * 24 * 30

/**
 * 客服聊天的訪客識別碼。
 *
 * 不共用 sagon_cart —— 那組 id 在登入合併購物車時會換發，換掉之後訪客
 * 就找不回自己的客服對話了，所以聊天需要一組獨立、不輪替的識別碼。
 */
const CHAT_COOKIE = 'sagon_chat'
const CHAT_COOKIE_MAX_AGE = 60 * 60 * 24 * 90

/**
 * 匿名訪客的識別碼都在這裡發放。
 *
 * Server Component 在 render 階段不能寫 cookie（Next.js 限制），
 * 所以由 proxy 保證每個訪客一進站就有 id，購物車頁與聊天視窗只要讀就好。
 */
function ensureVisitorCookies(req: NextRequest, res: NextResponse) {
  const options = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  }

  if (!req.cookies.has(CART_COOKIE)) {
    res.cookies.set(CART_COOKIE, crypto.randomUUID(), {
      ...options,
      maxAge: CART_COOKIE_MAX_AGE,
    })
  }
  if (!req.cookies.has(CHAT_COOKIE)) {
    res.cookies.set(CHAT_COOKIE, crypto.randomUUID(), {
      ...options,
      maxAge: CHAT_COOKIE_MAX_AGE,
    })
  }
  return res
}

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  const { isLoggedIn, role, locale } = await readSession(req)

  // 後台不做多語系，直接走 role 檢查
  if (pathname.startsWith('/admin')) {
    if (!isLoggedIn) {
      const url = new URL('/login', req.nextUrl.origin)
      url.searchParams.set('callbackUrl', pathname)
      return NextResponse.redirect(url)
    }
    if (role !== 'ADMIN') {
      return NextResponse.rewrite(new URL('/403', req.nextUrl.origin))
    }
    return NextResponse.next()
  }

  const path = stripLocale(pathname)

  if (!isLoggedIn && PROTECTED.some((re) => re.test(path))) {
    const url = new URL('/login', req.nextUrl.origin)
    url.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(url)
  }

  // 已登入的人不需要再看到登入/註冊頁
  if (isLoggedIn && (path === '/login' || path === '/register')) {
    return NextResponse.redirect(new URL('/account', req.nextUrl.origin))
  }

  const restored = applyAccountLocale(req, locale)
  const res = ensureVisitorCookies(req, intlMiddleware(req))
  if (restored) {
    res.cookies.set(LOCALE_COOKIE, restored, {
      sameSite: 'lax',
      path: '/',
      maxAge: LOCALE_COOKIE_MAX_AGE,
    })
  }
  return res
}

export const config = {
  // 排除 API、Next 靜態資源、以及任何有副檔名的檔案（圖片、favicon…）
  matcher: ['/((?!api|_next/static|_next/image|uploads|.*\\..*).*)'],
}
