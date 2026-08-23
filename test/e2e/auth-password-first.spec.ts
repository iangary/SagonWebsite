import { test, expect, type Page } from '@playwright/test'

/**
 * 手機會員的登入路線：第一次發驗證碼 → 全站硬擋設定密碼 → 之後用號碼＋密碼。
 *
 * 驗證碼靠 `SMS_PROVIDER=console` 在 dev 的 toast 上印出明碼（otpSentDev），
 * 所以這支 spec 只在開發環境跑得動 —— 正式供應商不會回傳明碼。
 *
 * 號碼帶時間戳，每次跑都是一支沒用過的新號碼：這樣「第一次」的前提才成立，
 * 重跑也不會撞到上一輪留下的帳號。
 */
const PHONE = `09${String(Date.now()).slice(-8)}`
/** 另一支號碼，專門測「在別台裝置設了密碼、這台的 token 還是舊的」 */
const PHONE2 = `09${String(Date.now() + 1).slice(-8)}`
const PASSWORD = 'e2ePassw0rd'

/**
 * 等 Auth.js 的 csrf cookie 落地再送登入。
 *
 * 登入頁是掛載後才去抓 /api/auth/csrf 設這個 cookie 的，Playwright 幾毫秒就按下按鈕，
 * 搶在 cookie 之前送出的話 Auth.js 會回 MissingCSRF，前端顯示成「帳號或密碼錯誤」。
 * 真人打字慢所以碰不到，但這是既有行為（後台 email 登入也一樣），不是這條流程的問題。
 */
async function waitForCsrfCookie(page: Page): Promise<void> {
  await expect
    .poll(async () => (await page.context().cookies()).some((c) => c.name.endsWith('csrf-token')), {
      timeout: 10_000,
    })
    .toBe(true)
}

/** 按下發送驗證碼，從 dev toast 上讀回明碼 */
async function sendCodeAndRead(page: Page): Promise<string> {
  await page.getByRole('button', { name: '發送驗證碼' }).click()
  const toast = page.getByText(/開發模式：\d{6}/)
  await expect(toast).toBeVisible()
  const text = (await toast.textContent()) ?? ''
  const code = /\d{6}/.exec(text)?.[0]
  expect(code, `toast 上沒有驗證碼：${text}`).toBeTruthy()
  return code!
}

test.describe.serial('手機驗證碼只發第一次', () => {
  /**
   * dev server 是第一次被打到才編譯那一頁的，冷編譯動輒十幾秒，
   * 會把單條測試的時間額度吃光。開跑前先各請求一次，把編譯成本挪到這裡。
   */
  test.beforeAll(async ({ request }) => {
    for (const path of ['/login', '/login/sms', '/forgot-password', '/account/orders', '/set-password']) {
      await request.get(path).catch(() => undefined)
    }
  })

  test('第一次用簡訊登入 → 被擋在設定密碼頁 → 設完才進得去會員中心', async ({ page }) => {
    await page.goto('/login/sms')
    await page.locator('#phone').fill(PHONE)

    const code = await sendCodeAndRead(page)
    await page.locator('#code').fill(code)
    await waitForCsrfCookie(page)
    await page.getByRole('button', { name: '會員登入' }).click()

    // 還沒有密碼 → proxy 全站硬擋，不管去哪一頁都會被丟回設定密碼頁
    await page.waitForURL(/\/set-password/)
    await page.goto('/')
    await page.waitForURL(/\/set-password/)
    await expect(page.getByRole('heading', { name: '設定密碼' })).toBeVisible()

    await page.locator('#password').fill(PASSWORD)
    await page.locator('#confirmPassword').fill(PASSWORD)
    await page.getByRole('button', { name: '設定密碼並繼續' }).click()

    // 設完密碼 token 上的旗標被清掉，站台解鎖
    await page.waitForURL(/\/account/)
    await page.goto('/')
    await expect(page).toHaveURL(/localhost:\d+\/(\?.*)?$/)
  })

  test('之後用手機號碼＋密碼就能登入', async ({ page }) => {
    await page.goto('/login')
    await page.locator('#identifier').fill(PHONE)
    await page.locator('#password').fill(PASSWORD)
    await waitForCsrfCookie(page)
    await page.getByRole('button', { name: '會員登入' }).click()

    await page.waitForURL(/\/account/)
  })

  test('已經有密碼的號碼不再發驗證碼，改指向忘記密碼', async ({ page }) => {
    await page.goto('/login/sms')
    await page.locator('#phone').fill(PHONE)
    await page.getByRole('button', { name: '發送驗證碼' }).click()

    await expect(page.getByText(/已經設定過密碼/)).toBeVisible()
    await expect(page.getByRole('link', { name: '忘記密碼？' })).toBeVisible()
  })

  test('忘記密碼：再索取一次驗證碼就能重設，重設後直接登入', async ({ page }) => {
    await page.goto('/forgot-password')
    await page.locator('#phone').fill(PHONE)

    const code = await sendCodeAndRead(page)
    await page.locator('#code').fill(code)
    await page.locator('#password').fill(`${PASSWORD}v2`)
    await page.locator('#confirmPassword').fill(`${PASSWORD}v2`)
    await waitForCsrfCookie(page)
    await page.getByRole('button', { name: '重設密碼並登入' }).click()

    await page.waitForURL(/\/account/)

    // 舊密碼失效、新密碼可用
    await page.context().clearCookies()
    await page.goto('/login')
    await page.locator('#identifier').fill(PHONE)
    await page.locator('#password').fill(PASSWORD)
    await waitForCsrfCookie(page)
    await page.getByRole('button', { name: '會員登入' }).click()
    await expect(page.getByText('帳號或密碼錯誤')).toBeVisible()

    await page.locator('#password').fill(`${PASSWORD}v2`)
    await page.getByRole('button', { name: '會員登入' }).click()
    await page.waitForURL(/\/account/)
  })

  test('別台裝置設過密碼後，這台的舊 token 不會被無限轉址關在設定頁', async ({ browser }) => {
    // 一條測試裡要開兩個 context、走過四個頁面。dev server 冷編譯時光是編頁面就會
    // 吃掉預設的 60 秒，用 test.slow() 把額度拉成三倍。
    test.slow()

    // 這台：用簡訊登入，token 上帶著「還要設密碼」
    const stale = await browser.newContext()
    const page = await stale.newPage()
    await page.goto('/login/sms')
    await page.locator('#phone').fill(PHONE2)
    const code = await sendCodeAndRead(page)
    await page.locator('#code').fill(code)
    await waitForCsrfCookie(page)
    await page.getByRole('button', { name: '會員登入' }).click()
    await page.waitForURL(/\/set-password/)

    // 另一台：走忘記密碼把密碼設好（這台的 token 於此變成舊的）
    const other = await browser.newContext()
    const otherPage = await other.newPage()
    await otherPage.goto('/forgot-password')
    await otherPage.locator('#phone').fill(PHONE2)
    const resetCode = await sendCodeAndRead(otherPage)
    await otherPage.locator('#code').fill(resetCode)
    await otherPage.locator('#password').fill(PASSWORD)
    await otherPage.locator('#confirmPassword').fill(PASSWORD)
    await waitForCsrfCookie(otherPage)
    await otherPage.getByRole('button', { name: '重設密碼並登入' }).click()
    await otherPage.waitForURL(/\/account/)
    await other.close()

    // 回到這台：頁面不 redirect（會跟 proxy 打成迴圈），而是給一顆「繼續」解鎖
    await page.goto('/account/orders')
    await page.waitForURL(/\/set-password/)
    await page.getByRole('button', { name: '繼續' }).click()
    await page.waitForURL(/\/account/)
    await stale.close()
  })
})
