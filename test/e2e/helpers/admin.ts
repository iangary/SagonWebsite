import { expect, type Page } from '@playwright/test'

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
