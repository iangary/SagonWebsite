import { test, expect, type Page } from '@playwright/test'
import { PRODUCT_CARD, loginAsCustomer } from './helpers/checkout'

/**
 * 「訪客加購物車 → 登入」的接續。
 *
 * 這條動線只有真的走一次登入才驗得到：合併發生在 Auth.js 的 signIn event 裡
 * （src/lib/auth/index.ts），而整合測試把 @/lib/auth 整包 mock 掉了，跑不到那段。
 *
 * 災情長這樣：登入後購物車看起來是空的，但按一次「直接購買」東西又全部回來 ——
 * 因為合併原本只寫在 getOrCreateCart()，而登入後看 /cart 是純讀取，
 * 會員只要有過一列 Cart（就算空的）就會把匿名車整台擋在外面。
 */

const REMOVE = '移除'

/**
 * 加一件買得到的商品進購物車。
 *
 * 不用 helpers 的 addFirstProductToCart —— 它固定挑第一件，而開發用的資料庫
 * 常常有商品被測試買到缺貨，挑到就會卡在「已售完」。這裡逐件試到找得到為止。
 */
async function addAnyAvailableProductToCart(page: Page): Promise<void> {
  await page.goto('/product/all')
  const hrefs = await page.locator(PRODUCT_CARD).evaluateAll((nodes) =>
    nodes.map((n) => (n as HTMLAnchorElement).getAttribute('href')!).slice(0, 12),
  )
  expect(hrefs.length).toBeGreaterThan(0)

  for (const href of hrefs) {
    await page.goto(href)

    const variants = page.getByTestId('variant-selector').locator('button:not([disabled])')
    if ((await variants.count()) > 0) await variants.first().click()

    const addToCart = page.getByRole('button', { name: '加入購物車' })
    if ((await addToCart.count()) === 0) continue // 整件售完

    await addToCart.click()
    await expect(page.getByText('已加入購物車')).toBeVisible()
    return
  }

  throw new Error('資料庫裡沒有任何買得到的商品，先跑 npm run seed 補庫存')
}

/** 清空目前這台車，但保留 Cart 那一列 —— 這就是災情的前置條件 */
async function emptyTheCart(page: Page): Promise<void> {
  await page.goto('/cart')
  for (;;) {
    const remove = page.getByRole('button', { name: REMOVE })
    const left = await remove.count()
    if (left === 0) break
    await remove.first().click()
    await expect(remove).toHaveCount(left - 1)
  }
  await expect(page.getByText('購物車是空的')).toBeVisible()
}

test('未登入加入購物車，登入後東西還在（會員先前留著一台空車）', async ({ page }) => {
  // 1. 先讓這個會員留下一台「存在但是空的」車
  await loginAsCustomer(page)
  await addAnyAvailableProductToCart(page)
  await emptyTheCart(page)

  // 2. 變回訪客（session 與 sagon_cart 都丟掉，等於換一台新裝置）
  await page.context().clearCookies()

  // 3. 訪客把東西放進購物車
  await addAnyAvailableProductToCart(page)
  await page.goto('/cart')
  await expect(page.getByRole('button', { name: REMOVE })).toHaveCount(1)

  // 4. 登入 —— signIn event 應該在這一刻就把匿名車併進會員車
  await loginAsCustomer(page)

  // 5. 東西還在，不需要先去按「直接購買」把它逼出來
  await page.goto('/cart')
  await expect(page.getByText('購物車是空的')).toBeHidden()
  await expect(page.getByRole('button', { name: REMOVE })).toHaveCount(1)

  // 6. 而且 CartItem 的 id 沒有換過：第一下就能改數量，不會吃到「找不到這個項目」
  await page.getByRole('button', { name: '增加數量' }).first().click()
  await expect(page.getByText('找不到這個項目')).toBeHidden()
  await expect(page.getByRole('button', { name: REMOVE })).toHaveCount(1)
})
