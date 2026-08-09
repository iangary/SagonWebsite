import { test, expect, type Browser, type Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'

/**
 * 客服聊天的完整動線：訪客發問 → 後台收到 → 客服回覆 → 訪客即時收到 → 結案。
 *
 * 這支測試的重點是那些單元測試碰不到的接縫：
 *  1. 回覆走的是 server action（`replyToConversation`），curl 打不到 —— 這裡才驗得到
 *     `requireAdmin()` 守衛與 revalidatePath 真的有生效。
 *  2. SSE 推送。訪客的視窗**全程不重新整理**，訊息要自己冒出來；
 *     斷言用的是「等訊息出現」，所以只要跑得過就代表 Redis → SSE → 瀏覽器整條路是通的。
 *
 * 刻意用兩個 browser context：訪客的身分是 proxy 發的 httpOnly cookie，
 * 同一個 context 沒辦法同時是匿名訪客又是已登入管理員。
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@sagon.local'
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'admin1234'

/** 所有測試訊息都帶這個前綴，收尾時據此清除。 */
const MARKER = 'E2E 客服測試'

/** 每輪用不同 token，避免上一輪殘留讓定位抓到錯的那一列。 */
function uniqueToken() {
  return Date.now().toString(36).toUpperCase()
}

async function loginAsAdmin(page: Page) {
  await page.goto('/login')
  await page.locator('#email').fill(ADMIN_EMAIL)
  await page.locator('#password').fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: '會員登入' }).click()
  await page.waitForURL(/\/account/)
}

/**
 * 清掉測試留下的對話。
 *
 * 後台沒有刪除對話的功能（正式營運也不該有），所以這裡直接連資料庫 ——
 * Playwright 跑在 Node，且 admin-catalog.spec.ts 已有直接用專案套件的先例。
 * 靠 Conversation → ChatMessage 的 onDelete: Cascade 一起帶走訊息。
 */
async function cleanupTestConversations() {
  const db = new PrismaClient()
  try {
    const stale = await db.chatMessage.findMany({
      where: { body: { contains: MARKER } },
      select: { conversationId: true },
      distinct: ['conversationId'],
    })
    if (stale.length > 0) {
      await db.conversation.deleteMany({
        where: { id: { in: stale.map((m) => m.conversationId) } },
      })
    }
  } finally {
    await db.$disconnect()
  }
}

/** 開一個乾淨的訪客 context，載入首頁讓 proxy 發下 sagon_chat cookie。 */
async function openVisitor(browser: Browser) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/')
  return { context, page }
}

test.describe('站內客服聊天', () => {
  // 這條動線會走過前台、後台列表、後台對話頁，dev 模式每個路由都要即時編譯
  test.describe.configure({ timeout: 180_000 })

  test.beforeAll(cleanupTestConversations)
  test.afterAll(cleanupTestConversations)

  test('訪客發問 → 客服回覆 → 訪客不重整就收到 → 結案', async ({ browser }) => {
    const token = uniqueToken()
    const question = `${MARKER} ${token} — 請問這件外套有 M 號嗎？`
    const answer = `${MARKER} ${token} — 有的，M 號還有 3 件`

    const { context: visitorContext, page: visitor } = await openVisitor(browser)
    const adminContext = await browser.newContext()
    const admin = await adminContext.newPage()

    try {
      // --- 訪客發問 ---
      await visitor.getByRole('button', { name: '聯絡客服' }).click()

      const panel = visitor.getByRole('region', { name: '客服訊息' })
      await expect(panel).toBeVisible()
      // 歡迎詞是前端寫死的，不經過資料庫
      await expect(panel).toContainText('關於商品、訂單或運送有任何問題')

      await panel.getByRole('textbox').fill(question)
      await panel.getByRole('button', { name: '送出' }).click()

      // 自己的訊息要立刻出現（POST 回傳後樂觀更新）
      await expect(panel).toContainText(question)

      // --- 客服在後台看到 ---
      await loginAsAdmin(admin)
      await admin.goto('/admin/chat')

      const row = admin.locator('tbody tr', { hasText: token })
      await expect(row).toHaveCount(1)
      await expect(row).toContainText('待回覆')
      // 未登入訪客要標示出來，客服才知道沒有帳號資料可查
      await expect(row).toContainText('未登入')

      await row.getByRole('link').first().click()
      await admin.waitForURL(/\/admin\/chat\/[a-z0-9]+$/)
      await expect(admin.getByText(question)).toBeVisible()

      // --- 客服回覆（這一步走 server action） ---
      const replyBox = admin.getByRole('textbox')
      await replyBox.fill(answer)
      await admin.getByRole('button', { name: '送出' }).click()

      // 刻意不斷言「已送出回覆」那個 toast —— 它 4 秒就自動消失，
      // 而 dev 模式下 server action 首次編譯可能就吃掉那段時間，測起來會時好時壞。
      // 改看三個留得住的結果，一樣能證明 action 真的跑完：
      await expect(admin.getByText(answer)).toBeVisible() // 訊息進了對話串
      await expect(replyBox).toHaveValue('') // 走到 result.ok 才會清空輸入框
      await expect(admin.getByText('已回覆')).toBeVisible() // revalidatePath 讓狀態重新渲染

      // --- 訪客端：整段過程都沒有重新整理，訊息必須由 SSE 自己推進來 ---
      await expect(panel).toContainText(answer)
      // 客服姓名來自 ChatMessage.author 關聯，順便驗證它接得起來
      await expect(panel).toContainText('系統管理員')

      // --- 結案 ---
      await admin.getByRole('button', { name: '標記結案' }).click()
      // 不用 getByText('已結案') 斷言 —— toast 與狀態徽章文字相同，strict mode 會抱怨兩筆命中。
      // 按鈕翻面成「重新開啟」本身就代表狀態換過去了。
      await expect(admin.getByRole('button', { name: '重新開啟' })).toBeVisible()

      await admin.goto('/admin/chat')
      await expect(admin.locator('tbody tr', { hasText: token })).toContainText('已結案')

      // --- 客人再發言應該自動重新開啟，不會另開一串 ---
      const followUp = `${MARKER} ${token} — 那幫我留一件`
      await panel.getByRole('textbox').fill(followUp)
      await panel.getByRole('button', { name: '送出' }).click()
      // 先確認真的送出去了，再去後台看，免得競爭到還沒寫進資料庫
      await expect(panel).toContainText(followUp)

      await admin.goto('/admin/chat')
      const reopened = admin.locator('tbody tr', { hasText: token })
      await expect(reopened).toHaveCount(1)
      await expect(reopened).toContainText('待回覆')
    } finally {
      await visitorContext.close()
      await adminContext.close()
    }
  })

  test('另一位訪客看不到別人的對話', async ({ browser }) => {
    const token = uniqueToken()
    const secret = `${MARKER} ${token} — 我的收件地址是台北市中山區`

    const { context: firstContext, page: first } = await openVisitor(browser)
    const { context: secondContext, page: second } = await openVisitor(browser)

    try {
      await first.getByRole('button', { name: '聯絡客服' }).click()
      const firstPanel = first.getByRole('region', { name: '客服訊息' })
      await firstPanel.getByRole('textbox').fill(secret)
      await firstPanel.getByRole('button', { name: '送出' }).click()
      await expect(firstPanel).toContainText(secret)

      // 第二位訪客有自己的 sagon_chat cookie，開起來應該是一片空白
      await second.getByRole('button', { name: '聯絡客服' }).click()
      const secondPanel = second.getByRole('region', { name: '客服訊息' })
      await expect(secondPanel).toBeVisible()
      await expect(secondPanel).not.toContainText(secret)
    } finally {
      await firstContext.close()
      await secondContext.close()
    }
  })

  test('非管理員不能進入客服收件匣', async ({ page }) => {
    await page.goto('/admin/chat')
    await expect(page).toHaveURL(/\/login/)
  })
})
