import { test, expect, type Page } from '@playwright/test'

/**
 * 後台商品維護的完整動線：新增 → 上傳圖片 → 加規格 → 上架 → 刪除。
 *
 * 這條路徑是營運每天在用的，而且橫跨檔案系統、資料庫與前台快取，
 * 手動測很花時間，值得自動化。
 *
 * 定位一律用 id 而不是 getByLabel —— 必填欄位的 label 後面有一顆星號，
 * 無障礙名稱會變成「密碼*」，用文字比對很容易踩到。
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@sagon.local'
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'admin1234'

/** 每次跑用不同名稱，避免上一輪殘留把測試搞混 */
function uniqueName() {
  return `E2E 測試商品 ${Date.now().toString(36).toUpperCase()}`
}

async function loginAsAdmin(page: Page) {
  await page.goto('/login')
  await page.locator('#email').fill(ADMIN_EMAIL)
  await page.locator('#password').fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: '會員登入' }).click()
  await page.waitForURL(/\/account/)
}

const TEST_PRODUCT_PREFIX = 'E2E 測試商品'

/**
 * 掃掉前一輪失敗留下的測試商品。
 *
 * 測試成功時會自己刪掉建立的商品，但中途失敗就會留在目錄裡污染其他測試
 * （例如「共 N 件商品」的數字）。開頭先清一次，讓測試可以重複執行。
 * 刻意走後台 UI 而不是直接連資料庫，順便也驗證了刪除功能。
 */
async function cleanupLeftoverTestProducts(page: Page) {
  await page.goto(`/admin/products?q=${encodeURIComponent(TEST_PRODUCT_PREFIX)}`)

  // 每刪一件列表就重整，所以每次都重新抓第一列
  for (let guard = 0; guard < 20; guard++) {
    const firstLink = page.locator('tbody a', { hasText: TEST_PRODUCT_PREFIX }).first()
    if ((await firstLink.count()) === 0) return

    await firstLink.click()
    await page.waitForURL(/\/admin\/products\/(?!new$)[a-z0-9]+$/)

    page.once('dialog', (dialog) => dialog.accept())
    // 沒賣過就是「永久刪除商品」，賣過的話會是「封存商品」
    await page.getByRole('button', { name: /永久刪除商品|封存商品/ }).click()
    await page.waitForURL(/\/admin\/products(\?|$)/)
    await page.goto(`/admin/products?q=${encodeURIComponent(TEST_PRODUCT_PREFIX)}`)
  }
}

/**
 * 產生一張真的 PNG。用大尺寸才驗得到「超過 1600px 會被縮小」，
 * 所以不能拿 1x1 的假圖充數。Playwright 跑在 Node，可直接用專案的 sharp。
 */
async function createImage(width: number, height: number): Promise<Buffer> {
  const sharp = (await import('sharp')).default
  return sharp({
    create: { width, height, channels: 3, background: '#c98b7f' },
  })
    .png()
    .toBuffer()
}

test.describe('後台商品維護', () => {
  // 這條動線會走過十幾個路由，dev 模式下每個都要即時編譯，
  // 預設的 60 秒不夠用（正式版建置後快得多）。
  test.describe.configure({ timeout: 180_000 })

  test('新增草稿商品 → 前台看不到 → 上架後看得到 → 刪除', async ({ page }) => {
    const name = uniqueName()

    await loginAsAdmin(page)
    await cleanupLeftoverTestProducts(page)

    // --- 新增（草稿） ---
    await page.goto('/admin/products/new')
    await page.locator('#name').fill(name)
    await page.locator('#price').fill('1234')
    await page.locator('#stock').fill('5')
    await page.locator('#variantName').fill('M')
    await page.getByRole('button', { name: '建立商品' }).click()

    // 建立後會導到編輯頁。要排除 new —— 否則這個 regex 會立刻在
    // /admin/products/new 上就成立，後面全部跑在錯的頁面上還一路通過。
    await page.waitForURL(/\/admin\/products\/(?!new$)[a-z0-9]+$/)
    const editUrl = page.url()
    expect(editUrl).not.toContain('/new')
    // 編輯頁才有的區塊，用來確認真的換頁了
    await expect(page.getByRole('heading', { name: '規格與庫存' })).toBeVisible()

    // 草稿不該出現在前台搜尋結果
    await page.goto(`/product/all?q=${encodeURIComponent(name)}`)
    await expect(page.getByText('共 0 件商品')).toBeVisible()

    // --- 上傳圖片 ---
    await page.goto(editUrl)
    await page.locator('input[name="images"]').setInputFiles({
      name: 'e2e-2400.png',
      mimeType: 'image/png',
      buffer: await createImage(2400, 1800),
    })
    await page.getByRole('button', { name: '上傳', exact: true }).click()

    // 上傳後會顯示縮圖與「主圖」標記，尺寸應被縮到 1600 寬
    await expect(page.getByText('主圖')).toBeVisible()
    await expect(page.getByText('1600×1200')).toBeVisible()

    // --- 新增第二個規格（比第一個便宜，用來驗證 basePrice 取最低價） ---
    await page.getByRole('button', { name: '新增規格' }).click()
    await page.locator('#new-name').fill('L')
    await page.locator('#new-price').fill('1000')
    await page.locator('#new-stock').fill('2')
    await page.getByRole('button', { name: '新增', exact: true }).click()
    await expect(page.getByRole('cell', { name: 'L', exact: true })).toBeVisible()

    // --- 上架 ---
    await page.locator('#status').selectOption('ACTIVE')
    await page.locator('form').filter({ has: page.locator('#status') }).getByRole('button', { name: '儲存' }).click()
    await expect(page.getByText('商品已更新')).toBeVisible()

    // 上架後前台就找得到，且顯示較低的那個規格價格。
    // 價格要在商品卡片裡面比對 —— 側邊欄的價格區間篩選也含有「NT$1,000」字樣。
    await page.goto(`/product/all?q=${encodeURIComponent(name)}`)
    await expect(page.getByText('共 1 件商品')).toBeVisible()
    await expect(page.getByRole('link', { name: new RegExp(name) })).toContainText('NT$1,000')

    // --- 刪除（沒賣過，應為永久刪除） ---
    await page.goto(editUrl)
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: '永久刪除商品' }).click()

    await page.waitForURL(/\/admin\/products$/)
    await page.goto(`/product/all?q=${encodeURIComponent(name)}`)
    await expect(page.getByText('共 0 件商品')).toBeVisible()
  })

  test('分類底下還有商品時不能刪除', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/admin/taxonomy')

    const categoryRows = page.getByTestId('category-manager').locator('tbody tr')
    const before = await categoryRows.count()
    expect(before).toBeGreaterThan(0)

    page.once('dialog', (dialog) => dialog.accept())
    await categoryRows.first().getByRole('button', { name: '刪除' }).click()

    // 應該看到擋下來的訊息，且列數不變
    await expect(page.getByText(/請先移除歸屬再刪除|請先處理子分類/)).toBeVisible()
    expect(await categoryRows.count()).toBe(before)
  })

  test('非管理員不能進入商品維護頁', async ({ page }) => {
    await page.goto('/admin/products/new')
    await expect(page).toHaveURL(/\/login/)
  })
})
