import { AsyncLocalStorage } from 'node:async_hooks'
import { vi } from 'vitest'

/**
 * 整合測試共用的 mock 工廠。
 *
 * vi.mock() 會被 hoist 到測試檔最上面，所以這裡只提供「工廠函式 + 可斷言的
 * spy」，各測試檔自己呼叫：
 *
 *   import { enqueueMock, queueMockModule } from '../integration/mocks'
 *   vi.mock('@/lib/queue', () => queueMockModule())
 *
 * 外部 HTTP 一律 mock 在模組邊界（@/lib/tcat/client、@/lib/ecpay/receipt 的
 * issueReceipt/invalidReceipt、@/lib/ecpay/logistics 的 createShipment），
 * 讓內部實作可以繼續變動而不弄壞測試。
 */

// --- @/lib/queue ------------------------------------------------------------

export const enqueueMock = vi.fn(async () => {})

export function queueMockModule() {
  return {
    QUEUE_NAME: 'sagon',
    enqueue: enqueueMock,
    registerRepeatableJobs: vi.fn(async () => {}),
    getQueue: vi.fn(),
    getRedis: vi.fn(),
  }
}

// --- @/lib/auth -------------------------------------------------------------

type MockUser = { id: string; role: 'ADMIN' | 'CUSTOMER'; email?: string | null } | null

/** 測試中途可換人：mockAuthUser(user) 之後，currentUser/requireUser/requireAdmin 都跟著變 */
let authUser: MockUser = null

export function mockAuthUser(user: MockUser): void {
  authUser = user
}

export function authMockModule() {
  return {
    auth: vi.fn(async () => (authUser ? { user: authUser } : null)),
    currentUser: vi.fn(async () => authUser),
    requireUser: vi.fn(async () => {
      if (!authUser) throw new Error('UNAUTHORIZED')
      return authUser
    }),
    requireAdmin: vi.fn(async () => {
      if (!authUser || authUser.role !== 'ADMIN') throw new Error('FORBIDDEN')
      return authUser
    }),
    normalizeTwMobile: (value: string) => {
      const digits = value.replace(/\D/g, '')
      return /^09\d{8}$/.test(digits) ? digits : null
    },
    handlers: {},
    signIn: vi.fn(),
    signOut: vi.fn(),
  }
}

// --- next/cache -------------------------------------------------------------

export const revalidatePathMock = vi.fn()

export function nextCacheMockModule() {
  return {
    revalidatePath: revalidatePathMock,
    revalidateTag: vi.fn(),
    unstable_cache: (fn: unknown) => fn,
  }
}

// --- next/headers -----------------------------------------------------------

/**
 * 記憶體 cookie jar。測試可以先塞值（模擬既有的 sagon_cart cookie），
 * 也可以查 set 過什麼。cookieJars 的 key 是「當前測試身分」——
 * 併發測試（兩個訪客搶庫存）用 withCookieJar() 切不同 jar。
 */
export class MemoryCookieJar {
  private store = new Map<string, string>()
  readonly setCalls: Array<{ name: string; value: string; options?: Record<string, unknown> }> = []

  get(name: string) {
    const value = this.store.get(name)
    return value === undefined ? undefined : { name, value }
  }
  set(name: string, value: string, options?: Record<string, unknown>) {
    this.store.set(name, value)
    this.setCalls.push({ name, value, options })
  }
  delete(name: string) {
    this.store.delete(name)
  }
  seed(name: string, value: string) {
    this.store.set(name, value)
  }
}

// 用 AsyncLocalStorage 而不是全域變數：併發測試（Promise.all 兩個訪客
// 同時下單）各自要有自己的 cookie jar，全域交換會互相污染。
const jarStorage = new AsyncLocalStorage<MemoryCookieJar>()

let defaultJar = new MemoryCookieJar()

export function resetCookieJar(): MemoryCookieJar {
  defaultJar = new MemoryCookieJar()
  return defaultJar
}

export function getCookieJar(): MemoryCookieJar {
  return jarStorage.getStore() ?? defaultJar
}

/** 在指定 jar 下執行 fn（例如模擬兩個不同訪客並發下單），可安全用於 Promise.all */
export async function withCookieJar<T>(jar: MemoryCookieJar, fn: () => Promise<T>): Promise<T> {
  return jarStorage.run(jar, fn)
}

export function nextHeadersMockModule() {
  return {
    cookies: async () => getCookieJar(),
    headers: async () => new Headers(),
  }
}
