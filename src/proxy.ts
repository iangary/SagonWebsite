import createIntlMiddleware from 'next-intl/middleware'
import NextAuth from 'next-auth'
import { NextResponse } from 'next/server'
import { routing, locales } from '@/i18n/routing'
import { authConfig } from '@/lib/auth/config'

const intlMiddleware = createIntlMiddleware(routing)

// 這裡只用 edge-safe 的設定，proxy 跑在 edge runtime，拿不到 Prisma。
const { auth } = NextAuth(authConfig)

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
function ensureVisitorCookies(req: Parameters<Parameters<typeof auth>[0]>[0], res: NextResponse) {
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

export default auth((req) => {
  const { pathname } = req.nextUrl
  const isLoggedIn = Boolean(req.auth?.user)
  const role = req.auth?.user?.role

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

  return ensureVisitorCookies(req, intlMiddleware(req))
})

export const config = {
  // 排除 API、Next 靜態資源、以及任何有副檔名的檔案（圖片、favicon…）
  matcher: ['/((?!api|_next/static|_next/image|uploads|.*\\..*).*)'],
}
