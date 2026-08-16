import { test, expect } from '@playwright/test'
import { useEnglish } from './helpers/locale'

/**
 * 前台的瀏覽動線。不依賴特定商品，從首頁一路點進去，
 * 所以換一批 seed 資料也不用改測試。
 */

/**
 * 商品卡片的連結。要排除導覽列的 /product/all，
 * 否則 a[href*="/product/"] 會先選到它而不是真正的商品。
 */
const PRODUCT_CARD = 'main a[href^="/product/"]:not([href="/product/all"])'

test('首頁顯示商店名稱、品牌與精選商品', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveTitle(/莎岡選品店/)
  await expect(page.getByRole('heading', { name: '品牌選購' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '精選商品' })).toBeVisible()

  expect(await page.locator(PRODUCT_CARD).count()).toBeGreaterThan(0)
})

test('全部商品頁可以依品牌篩選並改變結果數', async ({ page }) => {
  await page.goto('/product/all')

  const countText = page.getByText(/共 \d+ 件商品/)
  await expect(countText).toBeVisible()
  const before = Number((await countText.textContent())?.match(/\d+/)?.[0] ?? '0')
  expect(before).toBeGreaterThan(0)

  // 這是受控的 checkbox（改變後會導頁重新渲染），用 click 而不是 check，
  // check() 會斷言「點完之後狀態有變」，導頁時這個斷言不成立。
  await page.locator('aside input[type="checkbox"]').first().click()
  await page.waitForURL(/brand=/)

  const after = Number((await countText.textContent())?.match(/\d+/)?.[0] ?? '0')
  expect(after).toBeGreaterThan(0)
  expect(after).toBeLessThanOrEqual(before)
})

test('搜尋會把關鍵字帶進網址並顯示結果', async ({ page }) => {
  await page.goto('/product/all?q=睡衣')
  await expect(page.getByText(/「睡衣」的搜尋結果/)).toBeVisible()
})

test('商品詳情頁有價格、加入購物車與結構化資料', async ({ page }) => {
  await page.goto('/product/all')
  await page.locator(PRODUCT_CARD).first().click()

  await expect(page.getByRole('button', { name: '加入購物車' })).toBeVisible()
  await expect(page.getByText(/NT\$[\d,]+/).first()).toBeVisible()

  // JSON-LD 讓 Google 認得這是商品頁
  const jsonLd = await page.locator('script[type="application/ld+json"]').first().textContent()
  const parsed = JSON.parse(jsonLd ?? '{}')
  expect(parsed['@type']).toBe('Product')
  expect(parsed.offers.priceCurrency).toBe('TWD')
})

test('加入購物車後購物車頁看得到商品，且未登入時結帳頁可存取', async ({ page }) => {
  await page.goto('/product/all')
  await page.locator(PRODUCT_CARD).first().click()
  // 等真的離開列表頁再繼續，否則後面的選擇器會打到列表頁的篩選器
  await page.waitForURL(/\/product\/(?!all)/)

  // 有多規格的商品要先選規格。用 testid 鎖定，避免選到列表頁的價格區間按鈕。
  const variantButtons = page.getByTestId('variant-selector').locator('button:not([disabled])')
  if ((await variantButtons.count()) > 0) {
    await variantButtons.first().click()
  }

  await page.getByRole('button', { name: '加入購物車' }).click()
  await expect(page.getByText('已加入購物車')).toBeVisible()

  await page.goto('/cart')
  await expect(page.getByRole('heading', { name: '購物車' })).toBeVisible()
  await expect(page.getByRole('link', { name: '前往結帳' })).toBeVisible()

  await page.getByRole('link', { name: '前往結帳' }).click()
  await expect(page.getByRole('heading', { name: '結帳' })).toBeVisible()
  await expect(page.getByRole('button', { name: '確認送出訂單' })).toBeVisible()
})

test('未登入時 /account 會導向登入頁', async ({ page }) => {
  await page.goto('/account/orders')
  await expect(page).toHaveURL(/\/login/)
})

test('非管理員看不到後台', async ({ page }) => {
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/login/)
})

test('英文語系可用且導覽列翻譯正確', async ({ page }) => {
  await useEnglish(page)
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'All Products' }).first()).toBeVisible()
})

test('舊的 /en 連結會導回無前綴網址', async ({ page }) => {
  // localePrefix 從 as-needed 換成 never 之後，已經發出去的 /en/* 連結不能死掉
  await page.goto('/en/about')
  await expect(page).toHaveURL(/\/about$/)
})

test('sitemap 與 robots 可存取', async ({ request }) => {
  const sitemap = await request.get('/sitemap.xml')
  expect(sitemap.ok()).toBeTruthy()
  expect(await sitemap.text()).toContain('/product/')

  const robots = await request.get('/robots.txt')
  expect(robots.ok()).toBeTruthy()
  expect(await robots.text()).toContain('Sitemap:')
})
