import { test, expect, type Page } from '@playwright/test'
import { ecpayEnvReady, simulatePaid } from './helpers/ecpay'
import {
  addFirstProductToCart,
  choosePayment,
  fillContact,
  fillHomeAddress,
  gotoResult,
  stubCvsStoreSelection,
  submitAndCaptureOrderNo,
} from './helpers/checkout'
import { loginAsAdmin, openAdminOrder } from './helpers/admin'

/**
 * 後台訂單操作。刻意不按「建立物流訂單」—— 那會 enqueue 真的
 * create-shipment 工作，等 worker 一啟動就打到綠界 stage；建單的
 * 分流與防重複邏輯由整合測試覆蓋（test/integration/shipment-create.test.ts），
 * 真實建單見 docs/manual-test-stage.md M-5/M-6。
 */

test.skip(!ecpayEnvReady(), '缺少 ECPAY_* 環境變數（.env），略過後台訂單 E2E')

async function placeCvsOrder(page: Page): Promise<string> {
  await addFirstProductToCart(page)
  await page.goto('/checkout')
  await fillContact(page)
  await stubCvsStoreSelection(page)
  await choosePayment(page, 'Credit')
  return submitAndCaptureOrderNo(page)
}

test.describe('後台訂單操作', () => {
  test.describe.configure({ timeout: 240_000 })

  test('付款成功的訂單出現在後台且手動狀態流轉正常', async ({ page, request }) => {
    const orderNo = await placeCvsOrder(page)
    await simulatePaid(request, orderNo)

    await loginAsAdmin(page)
    await openAdminOrder(page, orderNo)

    // 已付款、有綠界交易編號、建單按鈕已啟用
    await expect(page.getByText('已付款').first()).toBeVisible()
    await expect(page.getByText('綠界交易編號')).toBeVisible()
    await expect(page.getByRole('button', { name: /建立物流訂單/ })).toBeEnabled()

    // 手動流轉：備貨中 → 已出貨 → 已完成
    const statusSelect = page.locator('select')
    await statusSelect.selectOption('PROCESSING')
    await expect(page.getByText(/已更新|備貨中/).first()).toBeVisible()
    await statusSelect.selectOption('SHIPPED')
    await expect(page.locator('header').getByText('已出貨')).toBeVisible()
    await statusSelect.selectOption('COMPLETED')
    await expect(page.locator('header').getByText('已完成')).toBeVisible()
  })

  test('待付款訂單可取消，取消後結果頁顯示付款未完成', async ({ page }) => {
    const orderNo = await placeCvsOrder(page)

    await loginAsAdmin(page)
    await openAdminOrder(page, orderNo)

    // 待付款：建單按鈕不可按、取消按鈕存在
    await expect(page.getByRole('button', { name: /建立物流訂單/ })).toBeDisabled()

    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: '取消訂單' }).click()
    await expect(page.locator('header').getByText('已取消')).toBeVisible()

    // 客人看到的結果頁
    await gotoResult(page, orderNo)
    await expect(page.getByRole('heading', { name: '付款未完成' })).toBeVisible()
  })

  test('宅配訂單可回填黑貓托運單號，格式錯誤會被擋', async ({ page, request }) => {
    // 建一張宅配訂單
    await addFirstProductToCart(page)
    await page.goto('/checkout')
    await fillContact(page)
    await fillHomeAddress(page)
    await choosePayment(page, 'Credit')
    const orderNo = await submitAndCaptureOrderNo(page)
    await simulatePaid(request, orderNo)

    await loginAsAdmin(page)
    await openAdminOrder(page, orderNo)

    // 格式錯誤（含空白與中文）
    page.once('dialog', (dialog) => dialog.accept('壞 單號!!'))
    await page.getByRole('button', { name: '回填托運單號' }).click()
    await expect(page.getByText(/格式|英數/).first()).toBeVisible()

    // 合法單號 → 貨態單號出現、訂單轉已出貨
    page.once('dialog', (dialog) => dialog.accept('9012345678'))
    await page.getByRole('button', { name: '回填托運單號' }).click()
    await expect(page.getByText('9012345678')).toBeVisible()
    await expect(page.locator('header').getByText('已出貨')).toBeVisible()
  })
})
