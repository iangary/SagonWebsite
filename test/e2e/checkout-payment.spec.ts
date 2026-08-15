import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import {
  buildPaymentReturn,
  ecpayEnvReady,
  getOrderAmount,
  postCallback,
  simulateAtmInfo,
  simulateCvsInfo,
  simulatePaid,
} from './helpers/ecpay'
import {
  addFirstProductToCart,
  choosePayment,
  fillContact,
  gotoResult,
  loginAsCustomer,
  stubCvsStoreSelection,
  submitAndCaptureOrderNo,
} from './helpers/checkout'

/**
 * 金流 E2E：真的走一次「加購物車 → 結帳 → 模擬綠界回拋 → 結果頁」。
 *
 * 前往綠界的表單會被攔下（見 submitAndCaptureOrderNo），回拋用與正式
 * 演算法相同、但獨立實作的簽章模擬 —— 完全不打綠界，測試可離線重複執行。
 * 真實刷卡留給 docs/manual-test-stage.md。
 */

test.skip(!ecpayEnvReady(), '缺少 ECPAY_* 環境變數（.env），略過金流 E2E')

async function orderStatus(request: APIRequestContext, orderNo: string) {
  const res = await request.get(`/api/orders/${orderNo}/status`)
  expect(res.ok()).toBeTruthy()
  return (await res.json()) as { status: string; paymentStatus: string | null }
}

/** 建一張等待付款的訂單（超商取貨 stub 門市），回傳訂單編號 */
async function placeOrder(page: Page, payment: 'Credit' | 'ATM' | 'CVS'): Promise<string> {
  await addFirstProductToCart(page)
  await page.goto('/checkout')
  await fillContact(page)
  await stubCvsStoreSelection(page)
  await choosePayment(page, payment)
  return submitAndCaptureOrderNo(page)
}

test.describe('結帳與付款回拋', () => {
  // dev 模式每個路由都要即時編譯，放寬單條時限
  test.describe.configure({ timeout: 240_000 })

  test('訪客信用卡結帳：等待付款 → 模擬回拋 → 結果頁自動更新為已成立', async ({
    page,
    request,
  }) => {
    const orderNo = await placeOrder(page, 'Credit')
    await gotoResult(page, orderNo)

    // 尚未回拋：等待付款狀態
    await expect(page.getByRole('heading', { name: '訂單已建立，等待付款' })).toBeVisible()

    // 從 Node 端模擬綠界背景通知
    await simulatePaid(request, orderNo)

    // 不重新整理 —— PaymentPoller 每 2.5 秒輪詢一次，應自己刷新成已成立
    await expect(page.getByRole('heading', { name: '訂單已成立' })).toBeVisible({
      timeout: 20_000,
    })

    // 重複回拋（綠界會重送）：仍回 1|OK 且狀態不變
    await simulatePaid(request, orderNo)
    const after = await orderStatus(request, orderNo)
    expect(after.status).toBe('PAID')
    expect(after.paymentStatus).toBe('PAID')
  })

  test('金額竄改、簽章竄改與失敗代碼都不能把訂單變成已付款', async ({ page, request }) => {
    const orderNo = await placeOrder(page, 'Credit')
    const amount = await getOrderAmount(request, orderNo)

    // 金額 +100（簽章正確）：處理器擋下，回 0| 讓綠界重送
    const tampered = buildPaymentReturn(orderNo, amount + 100)
    const tamperedRes = await postCallback(request, '/api/ecpay/payment/return', tampered)
    expect(tamperedRes.body.startsWith('0|')).toBeTruthy()
    expect((await orderStatus(request, orderNo)).status).toBe('PENDING_PAYMENT')

    // 簽章竄改：直接被驗簽擋下
    const badMac = buildPaymentReturn(orderNo, amount)
    badMac.CheckMacValue = badMac.CheckMacValue.replace(/^./, badMac.CheckMacValue[0] === 'A' ? 'B' : 'A')
    const badMacRes = await postCallback(request, '/api/ecpay/payment/return', badMac)
    expect(badMacRes.body.startsWith('0|')).toBeTruthy()
    expect((await orderStatus(request, orderNo)).status).toBe('PENDING_PAYMENT')

    // RtnCode ≠ 1（付款失敗通知）：記錄失敗但訂單留在待付款，可重試
    const failed = buildPaymentReturn(orderNo, amount, {
      RtnCode: '10200095',
      RtnMsg: '交易失敗',
    })
    const failedRes = await postCallback(request, '/api/ecpay/payment/return', failed)
    expect(failedRes.body).toBe('1|OK')
    const afterFailed = await orderStatus(request, orderNo)
    expect(afterFailed.status).toBe('PENDING_PAYMENT')
    expect(afterFailed.paymentStatus).toBe('FAILED')

    // 之後正確的成功回拋仍能完成付款（消費者換卡重試）
    await simulatePaid(request, orderNo)
    expect((await orderStatus(request, orderNo)).status).toBe('PAID')
  })

  test('ATM 取號：顯示轉帳資訊、隱藏重新付款，入帳後變已成立', async ({ page, request }) => {
    const orderNo = await placeOrder(page, 'ATM')

    await simulateAtmInfo(request, orderNo)
    await gotoResult(page, orderNo)

    // 轉帳資訊區塊
    await expect(page.getByRole('heading', { name: 'ATM 轉帳資訊' })).toBeVisible()
    await expect(page.getByText('9990012345678901')).toBeVisible()
    await expect(page.getByText('812')).toBeVisible()

    // 已取號就不能重新付款（重送會產生新的虛擬帳號）
    await expect(page.getByRole('link', { name: '重新付款' })).toHaveCount(0)

    // 模擬入帳
    await simulatePaid(request, orderNo, { PaymentType: 'ATM_TAISHIN' })
    await gotoResult(page, orderNo)
    await expect(page.getByRole('heading', { name: '訂單已成立' })).toBeVisible()
  })

  test('超商代碼：結果頁顯示繳費代碼與期限', async ({ page, request }) => {
    const orderNo = await placeOrder(page, 'CVS')

    await simulateCvsInfo(request, orderNo)
    await gotoResult(page, orderNo)

    await expect(page.getByRole('heading', { name: '超商繳費代碼' })).toBeVisible()
    await expect(page.getByText('LLL22167774958')).toBeVisible()
    await expect(page.getByRole('link', { name: '重新付款' })).toHaveCount(0)
  })

  test('會員結帳後訂單出現在帳戶的訂單列表', async ({ page, request }) => {
    await loginAsCustomer(page)
    const orderNo = await placeOrder(page, 'Credit')
    await simulatePaid(request, orderNo)

    await page.goto('/account/orders')
    await expect(page.getByText(orderNo)).toBeVisible()
  })
})
