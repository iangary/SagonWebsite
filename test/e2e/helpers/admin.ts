import { expect, test, type Page } from '@playwright/test'

/** 後台共用步驟（新 spec 用；admin-catalog.spec.ts 保留自己的版本不動） */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@sagon.local'
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'admin1234'

export async function loginAsAdmin(page: Page): Promise<void> {
  // 先把既有 session 清掉：結帳流程會先登入成會員（只有會員能結帳），
  // 而 /login 對已登入者會被 proxy 導去 /account，登入表單根本不會出現。
  await page.context().clearCookies()
  await page.goto('/login')
  await page.locator('#identifier').fill(ADMIN_EMAIL)
  await page.locator('#password').fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: '會員登入' }).click()
  await page.waitForURL(/\/account/)
}

/** 在後台訂單列表用訂單編號搜尋並進入詳情頁 */
export async function openAdminOrder(page: Page, orderNo: string): Promise<void> {
  await page.goto(`/admin/orders?q=${encodeURIComponent(orderNo)}`)
  const link = page.locator('tbody a', { hasText: orderNo }).first()
  await expect(link).toBeVisible()
  await link.click()
  await page.waitForURL(/\/admin\/orders\/[a-z0-9]+$/)
}

export const TEST_PRODUCT_PREFIX = 'E2E 測試商品'

export function uniqueProductName(): string {
  return `${TEST_PRODUCT_PREFIX} ${Date.now().toString(36).toUpperCase()}`
}

/**
 * 從後台設定開／關超商取貨，回傳改之前的值。
 *
 * 商店設定預設關閉超商取貨（正式站目前也是關的），結帳頁只剩宅配；
 * 測 7-11／全家選店與超商訂單的測試要先打開它。
 */
export async function setCvsEnabled(page: Page, enabled: boolean): Promise<boolean> {
  await loginAsAdmin(page)
  await page.goto('/admin/settings')
  const toggle = page.getByRole('checkbox', { name: '開放超商取貨' })
  const was = await toggle.isChecked()
  if (was !== enabled) {
    await toggle.setChecked(enabled)
    await page.getByRole('button', { name: '儲存運費設定' }).click()
    await expect(page.getByText('運費設定已儲存')).toBeVisible()
  }
  return was
}

/**
 * 在 test.describe 裡呼叫：整組開始前打開超商取貨，結束後還原成原本的值，
 * 不把測試環境的商店設定留在被改過的狀態。
 */
export function requireCvsPickup(): void {
  let wasEnabled = true
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    wasEnabled = await setCvsEnabled(page, true)
    await page.close()
  })
  test.afterAll(async ({ browser }) => {
    if (wasEnabled) return
    const page = await browser.newPage()
    await setCvsEnabled(page, false)
    await page.close()
  })
}

/**
 * 在 test.describe 裡呼叫：整組開始前在後台把指定的線上付款方式打開，結束後還原。
 *
 * ATM 虛擬帳號預設關閉（和「匯款／ATM 轉帳」容易混淆），超商代碼繳費在 2026-11-11
 * 由店家決定停用（見 migration disable_store_payment_codes）。功能本身還在，
 * 日後可能再打開，所以測試照測，只是測之前先打開。
 */
export function requirePaymentMethods(labels: ('ATM 虛擬帳號' | '超商代碼繳費')[]): void {
  let previous: Record<string, boolean> = {}

  async function apply(
    page: Page,
    wanted: (label: string) => boolean,
  ): Promise<Record<string, boolean>> {
    await loginAsAdmin(page)
    await page.goto('/admin/settings')
    const before: Record<string, boolean> = {}
    let changed = false
    for (const label of labels) {
      const box = page.getByRole('checkbox', { name: label, exact: true })
      before[label] = await box.isChecked()
      if (before[label] !== wanted(label)) {
        await box.setChecked(wanted(label))
        changed = true
      }
    }
    if (changed) {
      await page.getByRole('button', { name: '儲存付款設定' }).click()
      await expect(page.getByText('付款設定已儲存')).toBeVisible()
    }
    return before
  }

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage()
    previous = await apply(page, () => true)
    await page.close()
  })
  test.afterAll(async ({ browser }) => {
    if (Object.values(previous).every(Boolean)) return
    const page = await browser.newPage()
    await apply(page, (label) => previous[label] ?? true)
    await page.close()
  })
}
