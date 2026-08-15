import { expect, type Page } from '@playwright/test'

/**
 * 結帳流程的共用步驟。金額計算、門市選擇等細節見 checkout-form.tsx。
 */

/** 商品卡片連結（排除導覽列的 /product/all） */
export const PRODUCT_CARD = 'main a[href^="/product/"]:not([href="/product/all"])'

/** 從列表頁點進第一件商品並加入購物車（多規格商品自動選第一個可選規格） */
export async function addFirstProductToCart(page: Page): Promise<void> {
  await page.goto('/product/all')
  await page.locator(PRODUCT_CARD).first().click()
  await page.waitForURL(/\/product\/(?!all)/)

  const variantButtons = page.getByTestId('variant-selector').locator('button:not([disabled])')
  if ((await variantButtons.count()) > 0) {
    await variantButtons.first().click()
  }

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
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: '會員登入' }).click()
  await page.waitForURL(/\/(account|admin)/)
}

export async function loginAsCustomer(page: Page): Promise<void> {
  await loginAs(page, 'customer@sagon.local', process.env.SEED_ADMIN_PASSWORD ?? 'admin1234')
}
