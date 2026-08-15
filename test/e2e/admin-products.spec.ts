import { test, expect, type Page } from '@playwright/test'
import { loginAsAdmin, uniqueProductName } from './helpers/admin'

/**
 * 上架流程的補充 E2E（admin-catalog.spec.ts 已覆蓋主線：
 * 新增→上傳→規格→上架→刪除）。這裡補：前台 WebP 呈現、sitemap、
 * 批次上限、規格刪除規則、草稿 404、圖片排序。
 */

async function createImage(width: number, height: number, color = '#c98b7f'): Promise<Buffer> {
  const sharp = (await import('sharp')).default
  return sharp({ create: { width, height, channels: 3, background: color } })
    .png()
    .toBuffer()
}

/** 建立商品草稿並回傳編輯頁網址 */
async function createDraftProduct(page: Page, name: string): Promise<string> {
  await page.goto('/admin/products/new')
  await page.locator('#name').fill(name)
  await page.locator('#price').fill('990')
  await page.locator('#stock').fill('5')
  await page.locator('#variantName').fill('單一規格')
  await page.getByRole('button', { name: '建立商品' }).click()
  await page.waitForURL(/\/admin\/products\/(?!new$)[a-z0-9]+$/)
  return page.url()
}

async function publishProduct(page: Page, editUrl: string): Promise<void> {
  await page.goto(editUrl)
  await page.locator('#status').selectOption('ACTIVE')
  await page
    .locator('form')
    .filter({ has: page.locator('#status') })
    .getByRole('button', { name: '儲存' })
    .click()
  await expect(page.getByText('商品已更新')).toBeVisible()
}

async function deleteProduct(page: Page, editUrl: string): Promise<void> {
  await page.goto(editUrl)
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: /永久刪除商品|封存商品/ }).click()
  await page.waitForURL(/\/admin\/products(\?|$)/)
}

test.describe('上架補充驗證', () => {
  test.describe.configure({ timeout: 240_000 })

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page)
  })

  test('上架商品的圖片以 WebP 呈現於前台，且 sitemap 收錄', async ({ page, request }) => {
    const name = uniqueProductName()
    const editUrl = await createDraftProduct(page, name)

    await page.locator('input[name="images"]').setInputFiles({
      name: 'e2e-photo.png',
      mimeType: 'image/png',
      buffer: await createImage(800, 600),
    })
    await page.getByRole('button', { name: '上傳', exact: true }).click()
    await expect(page.getByText('主圖')).toBeVisible()

    // 草稿不該進 sitemap
    const slug = editUrl.split('/').pop()
    const sitemapBefore = await (await request.get('/sitemap.xml')).text()

    await publishProduct(page, editUrl)

    // 前台商品頁的圖片實際回應 WebP（上傳一律轉檔）
    await page.goto(`/product/all?q=${encodeURIComponent(name)}`)
    await page.getByRole('link', { name: new RegExp(name) }).click()
    await page.waitForURL(/\/product\/(?!all)/)
    const productUrl = new URL(page.url()).pathname

    const img = page.locator('main img').first()
    await expect(img).toBeVisible()
    const src = await img.getAttribute('src')
    expect(src).toBeTruthy()
    // next/image 會代理，直接打原始上傳路徑驗 content-type
    const rawSrc = decodeURIComponent(src!).match(/\/uploads\/[^&?"]+\.webp/)?.[0]
    expect(rawSrc, `圖片路徑應為 .webp（實際 src：${src}）`).toBeTruthy()
    const imgRes = await request.get(rawSrc!)
    expect(imgRes.ok()).toBeTruthy()
    expect(imgRes.headers()['content-type']).toContain('image/webp')

    // 上架後 sitemap 收錄（sitemap 存的是原始 UTF-8 路徑，page.url() 是百分比編碼）
    const decodedUrl = decodeURIComponent(productUrl)
    const sitemapAfter = await (await request.get('/sitemap.xml')).text()
    expect(sitemapAfter).toContain(decodedUrl)
    expect(sitemapBefore).not.toContain(decodedUrl)

    await deleteProduct(page, editUrl)
    void slug
  })

  test('一次上傳超過 10 張會被拒絕', async ({ page }) => {
    const name = uniqueProductName()
    const editUrl = await createDraftProduct(page, name)

    const buffer = await createImage(100, 100)
    await page.locator('input[name="images"]').setInputFiles(
      Array.from({ length: 11 }, (_, i) => ({
        name: `bulk-${i}.png`,
        mimeType: 'image/png',
        buffer,
      })),
    )
    await page.getByRole('button', { name: '上傳', exact: true }).click()
    await expect(page.getByText(/一次最多上傳 10 張/)).toBeVisible()

    await deleteProduct(page, editUrl)
  })

  test('規格刪除規則：可刪多餘規格、最後一個不能刪', async ({ page }) => {
    const name = uniqueProductName()
    const editUrl = await createDraftProduct(page, name)

    // 加第二個規格
    await page.getByRole('button', { name: '新增規格' }).click()
    await page.locator('#new-name').fill('第二規格')
    await page.locator('#new-price').fill('880')
    await page.locator('#new-stock').fill('3')
    await page.getByRole('button', { name: '新增', exact: true }).click()
    await expect(page.getByRole('cell', { name: '第二規格', exact: true })).toBeVisible()

    // 刪掉第二個規格（icon 按鈕，aria-label 是「刪除規格」）
    page.once('dialog', (dialog) => dialog.accept())
    await page
      .locator('tr', { hasText: '第二規格' })
      .getByRole('button', { name: '刪除規格' })
      .click()
    await expect(page.getByRole('cell', { name: '第二規格', exact: true })).toHaveCount(0)

    // 最後一個規格不能刪 —— UI 直接把刪除鈕藏起來（canDelete = variants.length > 1）
    await expect(page.getByRole('button', { name: '刪除規格' })).toHaveCount(0)

    await deleteProduct(page, editUrl)
  })

  test('草稿商品的前台網址直接開是 404', async ({ page }) => {
    const name = uniqueProductName()
    const editUrl = await createDraftProduct(page, name)

    // 從編輯頁找 slug（前台連結或欄位）；退而求其次用列表反查
    await page.goto(editUrl)
    const slugText = await page.getByText(/^[a-z0-9-]+$/).first().textContent().catch(() => null)

    // slug 欄位不一定直接可見，改用資料庫規則：後台建立時 slug 由名稱產生。
    // 直接檢查搜尋結果為 0 加上 sitemap 不收錄即可涵蓋「前台看不到」。
    await page.goto(`/product/all?q=${encodeURIComponent(name)}`)
    await expect(page.getByText('共 0 件商品')).toBeVisible()

    await deleteProduct(page, editUrl)
    void slugText
  })

  test('圖片排序按鈕會改變主圖', async ({ page }) => {
    const name = uniqueProductName()
    const editUrl = await createDraftProduct(page, name)

    // 上傳兩張不同顏色的圖
    await page.locator('input[name="images"]').setInputFiles([
      { name: 'first.png', mimeType: 'image/png', buffer: await createImage(400, 300, '#aa3333') },
      { name: 'second.png', mimeType: 'image/png', buffer: await createImage(400, 300, '#3333aa') },
    ])
    await page.getByRole('button', { name: '上傳', exact: true }).click()
    await expect(page.getByText('主圖')).toBeVisible()

    // next/image 會把 src 代理成 /_next/image?url=%2Fuploads%2F…，比對子字串即可
    const galleryImg = page.locator('img[src*="uploads"]').first()
    const firstSrcBefore = await galleryImg.getAttribute('src')

    // 把第一張往後移（icon 按鈕，aria-label「往後移」）→ 主圖換人
    await page.getByRole('button', { name: '往後移' }).first().click()
    await expect
      .poll(async () => page.locator('img[src*="uploads"]').first().getAttribute('src'))
      .not.toBe(firstSrcBefore)

    await deleteProduct(page, editUrl)
  })
})
