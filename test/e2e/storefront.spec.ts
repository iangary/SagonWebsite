import { test, expect } from '@playwright/test'
import { useEnglish } from './helpers/locale'
import { addFirstProductToCart, openAvailableProduct } from './helpers/checkout'

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
  await openAvailableProduct(page)

  await expect(page.getByRole('button', { name: '加入購物車' })).toBeVisible()
  await expect(page.getByText(/NT\$[\d,]+/).first()).toBeVisible()

  // JSON-LD 讓 Google 認得這是商品頁。
  // layout 在 <body> 最前面還有一段全站的 @graph（Organization／WebSite），
  // 商品頁自己那段則是 [Product, BreadcrumbList] 陣列，
  // 所以不能拿第一段，要全部攤平後找 @type 是 Product 的那一筆。
  const blocks = (await page.locator('script[type="application/ld+json"]').allTextContents())
    .flatMap((text) => [JSON.parse(text)].flat())
    .flatMap((ld) => (Array.isArray(ld['@graph']) ? ld['@graph'] : [ld]))
  const product = blocks.find((ld) => ld['@type'] === 'Product')
  expect(product).toBeDefined()
  // offers 是每個變體一筆 Offer 的陣列
  expect(product.offers.length).toBeGreaterThan(0)
  for (const offer of product.offers) {
    expect(offer.priceCurrency).toBe('TWD')
  }
})

test('加入購物車後購物車頁看得到商品，未登入按結帳會被帶去註冊', async ({ page }) => {
  await addFirstProductToCart(page)

  await page.goto('/cart')
  await expect(page.getByRole('heading', { name: '購物車' })).toBeVisible()
  await expect(page.getByRole('link', { name: '前往結帳' })).toBeVisible()

  // 只有會員能結帳：訪客按下去會到註冊頁，並看到「為什麼在這裡」的提示
  await page.getByRole('link', { name: '前往結帳' }).click()
  await expect(page).toHaveURL(/\/register\?callbackUrl=%2Fcheckout/)
  await expect(page.getByRole('heading', { name: '註冊會員' })).toBeVisible()
  await expect(page.getByText('結帳需要會員帳號')).toBeVisible()
})

test('未登入直接開結帳頁會被導去註冊', async ({ page }) => {
  await page.goto('/checkout')
  await expect(page).toHaveURL(/\/register\?callbackUrl=%2Fcheckout/)
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
