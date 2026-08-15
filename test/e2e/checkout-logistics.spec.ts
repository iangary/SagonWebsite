import { test, expect } from '@playwright/test'
import { addFirstProductToCart, fillContact, fillHomeAddress, stubCvsStoreSelection } from './helpers/checkout'

/**
 * 物流相關的結帳行為：選店結果的接收合約（postMessage / sessionStorage /
 * token 驗證）、宅配地址驗證、運費計算。
 *
 * 真實的綠界電子地圖是外部服務，這裡全部用 stub —— 我們要測的是
 * 「我們這端怎麼收結果」，不是綠界的地圖長什麼樣。真實選店見
 * docs/manual-test-stage.md M-4。
 */

test.describe('結帳物流', () => {
  test.describe.configure({ timeout: 180_000 })

  test.beforeEach(async ({ page }) => {
    await addFirstProductToCart(page)
    await page.goto('/checkout')
    await fillContact(page)
  })

  test('未選門市就送出會被擋下', async ({ page }) => {
    await page.getByRole('button', { name: '確認送出訂單' }).click()
    // superRefine 的欄位錯誤訊息會顯示在選店按鈕下方
    await expect(page.getByText(/請選擇取貨門市/)).toBeVisible()
    await expect(page).toHaveURL(/\/checkout/)
  })

  test('postMessage 選店結果（token 相符）會顯示門市資訊', async ({ page }) => {
    await stubCvsStoreSelection(page, { storeName: 'E2E postMessage 門市' })
    await expect(page.getByText('E2E postMessage 門市')).toBeVisible()
    await expect(page.getByText('門市代號 131386')).toBeVisible()
    // 選店後按鈕變成「更換門市」
    await expect(page.getByRole('button', { name: '更換門市' })).toBeVisible()
  })

  test('token 不符的選店訊息會被忽略（防跨視窗塞資料）', async ({ page }) => {
    await page.evaluate(() => {
      sessionStorage.setItem('ecpay:cvs-map-token', 'the-real-token')
      window.postMessage(
        {
          type: 'ecpay:cvs-store-selected',
          store: {
            subType: 'UNIMARTC2C',
            storeId: '999999',
            storeName: '惡意門市',
            address: '不存在的地址',
            telephone: '',
          },
          token: 'a-forged-token',
        },
        window.location.origin,
      )
    })
    // 給 onMessage 一點時間，確認畫面沒有出現這間門市
    await page.waitForTimeout(500)
    await expect(page.getByText('惡意門市')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '選擇取貨門市' })).toBeVisible()
  })

  test('sessionStorage fallback（手機無 opener 的路徑）會自動帶入門市', async ({ page }) => {
    // 模擬 map-reply 頁寫入的格式：{ store, token }，token 與結帳頁存的一致
    await page.evaluate(() => {
      sessionStorage.setItem('ecpay:cvs-map-token', 'e2e-fallback-token')
      sessionStorage.setItem(
        'ecpay:cvs-store',
        JSON.stringify({
          store: {
            subType: 'FAMIC2C',
            storeId: 'F123456',
            storeName: 'E2E 全家門市',
            address: '新北市板橋區文化路一段 1 號',
            telephone: '',
          },
          token: 'e2e-fallback-token',
        }),
      )
    })
    await page.reload()
    await expect(page.getByText('E2E 全家門市')).toBeVisible()
  })

  test('宅配地址驗證：壞郵遞區號與缺欄位都有對應錯誤訊息', async ({ page }) => {
    await fillHomeAddress(page, { zip: 'ab', line: '' })
    await page.getByRole('button', { name: '確認送出訂單' }).click()

    // zod schema：zip 要 3~5 碼數字、詳細地址必填
    await expect(page.getByText(/郵遞區號/)).toBeVisible()
    await expect(page.locator('#addressLine ~ p, [id="addressLine"] + p').or(page.getByText(/請填寫.*地址|地址.*必填/)).first()).toBeVisible()
    await expect(page).toHaveURL(/\/checkout/)
  })

  test('切換配送方式會即時重算運費', async ({ page }) => {
    const summary = page.locator('aside')

    // 先記下超商運費列的文字（可能是金額或免運費）
    const feeRow = summary.locator('dl div', { hasText: '運費' }).locator('dd')
    const cvsFee = (await feeRow.textContent())?.trim()

    await page.getByRole('button', { name: '宅配到府' }).click()
    await expect
      .poll(async () => (await feeRow.textContent())?.trim(), { timeout: 5000 })
      .not.toBe(undefined)
    const homeFee = (await feeRow.textContent())?.trim()

    // 有達免運門檻時兩者都顯示「免運費」；否則兩種運費應該不同
    if (cvsFee === '免運費') {
      expect(homeFee).toBe('免運費')
    } else {
      expect(homeFee).not.toBe(cvsFee)
    }
  })
})
