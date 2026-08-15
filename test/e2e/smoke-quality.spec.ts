import { test, expect } from '@playwright/test'
import { PRODUCT_CARD } from './helpers/checkout'

/**
 * 全站品質 smoke：console 錯誤、i18n 洩漏、基本 a11y 結構。
 * 逐頁深入的走查另見 docs/site-review-findings.md。
 */

const KEY_ROUTES = ['/', '/product/all', '/cart', '/login', '/register', '/faq', '/about', '/order/query']

test.describe('全站品質 smoke', () => {
  test.describe.configure({ timeout: 240_000 })

  test('關鍵頁面沒有 console 錯誤與未捕捉例外', async ({ page }) => {
    const problems: string[] = []
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return
      const text = msg.text()
      // dev 模式的 HMR/404 廣告攔截等已知雜訊先放行
      if (/Download the React DevTools|Failed to load resource.*favicon/.test(text)) return
      problems.push(`console.error @ ${page.url()}: ${text}`)
    })
    page.on('pageerror', (err) => {
      problems.push(`pageerror @ ${page.url()}: ${err.message}`)
    })

    for (const route of KEY_ROUTES) {
      await page.goto(route)
      await page.waitForLoadState('networkidle')
    }

    // 商品詳情頁（動態路由）也掃一次
    await page.goto('/product/all')
    await page.locator(PRODUCT_CARD).first().click()
    await page.waitForLoadState('networkidle')

    expect(problems, problems.join('\n')).toHaveLength(0)
  })

  test('英文版頁面沒有未翻譯的 i18n key', async ({ page }) => {
    for (const route of ['/en', '/en/product/all', '/en/cart', '/en/login']) {
      await page.goto(route)
      const body = (await page.locator('main').textContent()) ?? ''

      // 沒翻到的 key 會以 namespace.key 原樣出現
      expect(body, `${route} 出現原始 i18n key`).not.toMatch(/\b\w+\.\w+Title\b/)
    }
  })

  test('英文版介面骨架沒有殘留中文', async ({ page }) => {
    // 已知問題（見 docs/site-review-findings.md R14）：/en 的公告列、footer 文案
    // 寫死中文，導覽的分類名稱沒有用 Category.nameEn。修好後這條會轉綠，
    // Playwright 會提示移除 test.fail 標記。
    test.fail(true, '英文版 header/footer 仍殘留中文（R14）')
    await page.goto('/en')
    const chrome = `${await page.locator('header').first().textContent()}${await page.locator('footer').first().textContent()}`
    const chinese = chrome.match(/[一-鿿]{2,}/g) ?? []
    expect(chinese, `/en 的介面骨架殘留中文：${chinese.join('、')}`).toHaveLength(0)
  })

  test('每頁恰有一個 main 與一個 h1，商品圖有 alt 屬性', async ({ page }) => {
    for (const route of ['/', '/product/all', '/cart', '/login']) {
      await page.goto(route)
      expect(await page.locator('main').count(), `${route} 的 main 數量`).toBe(1)
      expect(await page.locator('h1').count(), `${route} 的 h1 數量`).toBe(1)
    }

    await page.goto('/product/all')
    await page.locator(PRODUCT_CARD).first().click()
    await page.waitForURL(/\/product\/(?!all)/)
    const images = page.locator('main img')
    const count = await images.count()
    for (let i = 0; i < count; i++) {
      expect(
        await images.nth(i).getAttribute('alt'),
        `商品頁第 ${i + 1} 張圖缺 alt`,
      ).not.toBeNull()
    }
  })
})
