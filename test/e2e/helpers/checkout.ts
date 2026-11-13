import { expect, type Page } from '@playwright/test'
import Redis from 'ioredis'

/**
 * 結帳流程的共用步驟。金額計算、門市選擇等細節見 checkout-form.tsx。
 */

/** 商品卡片連結（排除導覽列的 /product/all） */
export const PRODUCT_CARD = 'main a[href^="/product/"]:not([href="/product/all"])'

/**
 * 打開一件買得到的商品頁，並選好第一個可選規格。
 *
 * 不固定挑列表第一件：前面的測試下單會把它的庫存預扣掉，整件變成「已售完」、
 * 沒有加入購物車按鈕，後面每個測試就跟著卡住。這裡逐件試到找得到為止。
 */
export async function openAvailableProduct(page: Page): Promise<void> {
  await page.goto('/product/all')
  const hrefs = await page
    .locator(PRODUCT_CARD)
    .evaluateAll((nodes) =>
      nodes.map((n) => (n as HTMLAnchorElement).getAttribute('href')!).slice(0, 24),
    )
  expect(hrefs.length).toBeGreaterThan(0)

  for (const href of hrefs) {
    await page.goto(href)
    const variants = page.getByTestId('variant-selector').locator('button:not([disabled])')
    if ((await variants.count()) > 0) await variants.first().click()
    if ((await page.getByRole('button', { name: '加入購物車' }).count()) > 0) return
  }

  throw new Error('資料庫裡沒有任何買得到的商品，先跑 npm run seed 補庫存')
}

/** 加一件買得到的商品進購物車 */
export async function addFirstProductToCart(page: Page): Promise<void> {
  await openAvailableProduct(page)
  await page.getByRole('button', { name: '加入購物車' }).click()
  await expect(page.getByText('已加入購物車')).toBeVisible()
}

/** 填寫收件人與聯絡資訊 */
export async function fillContact(
  page: Page,
  overrides: { name?: string; phone?: string; email?: string } = {},
): Promise<void> {
  const stamp = Date.now().toString(36)
  await page.locator('#recipientName').fill(overrides.name ?? `E2E測試買家${stamp}`)
  await page.locator('#recipientPhone').fill(overrides.phone ?? '0912345678')
  await page.locator('#email').fill(overrides.email ?? `e2e+${stamp}@sagon.local`)
}

/**
 * 用 stub 模擬綠界電子地圖選店結果。
 *
 * 真實地圖是外部服務（易斷線、DOM 不受我們控制），E2E 只驗證我們這端
 * 「收結果」的合約：同源 postMessage + token 比對（token 防護見 F4 修復）。
 * 真實選店留給 docs/manual-test-stage.md M-4。
 */
export async function stubCvsStoreSelection(
  page: Page,
  store: {
    subType?: string
    storeId?: string
    storeName?: string
    address?: string
    telephone?: string
  } = {},
): Promise<void> {
  await page.evaluate((s) => {
    const token = 'e2e-map-token'
    sessionStorage.setItem('ecpay:cvs-map-token', token)
    window.postMessage(
      {
        type: 'ecpay:cvs-store-selected',
        store: {
          subType: s.subType ?? 'UNIMARTC2C',
          storeId: s.storeId ?? '131386',
          storeName: s.storeName ?? 'E2E 測試門市',
          address: s.address ?? '台北市中山區南京東路一段 1 號',
          telephone: s.telephone ?? '0226081181',
        },
        token,
      },
      window.location.origin,
    )
  }, store)

  await expect(page.getByText(store.storeName ?? 'E2E 測試門市')).toBeVisible()
}

/** 切到宅配並填地址 */
export async function fillHomeAddress(
  page: Page,
  overrides: { zip?: string; city?: string; district?: string; line?: string } = {},
): Promise<void> {
  await page.getByRole('button', { name: '宅配到府' }).click()
  await page.locator('#addressZip').fill(overrides.zip ?? '104')
  await page.locator('#addressCity').selectOption(overrides.city ?? '台北市')
  await page.locator('#addressDistrict').fill(overrides.district ?? '中山區')
  await page.locator('#addressLine').fill(overrides.line ?? '南京東路一段 100 號 5 樓')
}

/** 選擇付款方式（Credit / ATM / CVS） */
export async function choosePayment(page: Page, method: 'Credit' | 'ATM' | 'CVS'): Promise<void> {
  await page.locator(`input[name="choosePayment"][value="${method}"]`).check()
}

/**
 * 送出訂單並攔下前往綠界的自動表單，回傳訂單編號。
 *
 * 流程：submitCheckout 成功 → location.assign('/api/ecpay/payment/checkout/{orderNo}')
 * → 該路由回自動送出表單 → POST 到綠界 stage。最後一步用 route stub 擋掉，
 * 訂單已成立但不會有流量離開本機。
 */
export async function submitAndCaptureOrderNo(page: Page): Promise<string> {
  await page.route('**://payment-stage.ecpay.com.tw/**', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html><body>E2E stub：已攔下前往綠界的表單</body></html>',
    }),
  )

  // 用 request 監聽而不是 waitForURL：auto-submit 表單會立刻再導向綠界，
  // waitForURL 可能錯過中間那一站
  const checkoutRequest = page.waitForRequest(/\/api\/ecpay\/payment\/checkout\/[A-Z0-9]+$/)
  await page.getByRole('button', { name: '確認送出訂單' }).click()
  const req = await checkoutRequest

  const orderNo = new URL(req.url()).pathname.split('/').pop()
  expect(orderNo, '無法從結帳導向網址取得訂單編號').toBeTruthy()
  return orderNo!
}

/** 前往結果頁 */
export async function gotoResult(page: Page, orderNo: string): Promise<void> {
  await page.goto(`/checkout/result?orderNo=${orderNo}`)
}

export async function loginAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login')
  await page.locator('#identifier').fill(email)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: '會員登入' }).click()
  await page.waitForURL(/\/(account|admin)/)
}

export async function loginAsCustomer(page: Page): Promise<void> {
  await loginAs(page, 'customer@sagon.local', process.env.SEED_ADMIN_PASSWORD ?? 'admin1234')
}

/**
 * 註冊一個全新會員並自動登入。
 *
 * 每個測試都開自己的會員，而不是共用種子帳號 —— 購物車現在掛在會員身上，
 * 共用一個帳號的話上一個測試沒結完的車會影響下一個測試的金額。
 */
/**
 * 清掉「同 IP 每小時最多註冊 10 次」的計數（src/app/[locale]/(auth)/register/actions.ts）。
 *
 * 整套 e2e 會開好幾十個新會員，本機又沒有 Caddy 帶 X-Real-IP，全部擠在 'unknown' 這個桶，
 * 跑到第 11 個就被擋在註冊頁。只清註冊的計數，登入失敗、簡訊等其他節流不動；
 * 節流本身在網站上照常運作，這裡只是讓測試能一直開新帳號。
 */
async function resetSignupThrottle(): Promise<void> {
  const url = process.env.REDIS_URL
  if (!url) return
  const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 })
  try {
    await redis.connect()
    const keys = await redis.keys('rl:register:ip:*')
    if (keys.length > 0) await redis.del(...keys)
  } catch {
    // 連不到 Redis（例如對遠端環境跑 e2e）就不清，最多是多開幾個帳號後被擋
  } finally {
    redis.disconnect()
  }
}

export async function registerNewMember(page: Page): Promise<{ email: string; password: string }> {
  await resetSignupThrottle()
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`
  const email = `e2e+${stamp}@sagon.local`
  const password = 'e2e-Pass-1234'

  await page.goto('/register')
  await page.locator('#name').fill(`E2E測試買家${stamp}`)
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.locator('#confirmPassword').fill(password)
  await page.getByRole('button', { name: '註冊會員' }).click()
  await page.waitForURL(/\/account/)

  return { email, password }
}

/**
 * 走到結帳頁：註冊會員 → 加購物車 → /checkout。
 *
 * **只有會員能結帳**（見 lib/auth/checkout-gate.ts），所以要先有身分；
 * 而且要先登入再加購物車，東西才會直接進會員車。訪客被擋下的行為由
 * storefront.spec.ts 驗。
 */
export async function startMemberCheckout(page: Page): Promise<void> {
  await registerNewMember(page)
  await addFirstProductToCart(page)
  await page.goto('/checkout')
}
