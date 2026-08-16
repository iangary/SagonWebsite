import { type Page } from '@playwright/test'

/**
 * 語系切換的共用步驟。
 *
 * localePrefix 是 never（見 src/i18n/routing.ts）：網址上沒有 /en 可以走，
 * 語言由 NEXT_LOCALE cookie 決定，所以要測英文版得先種 cookie 再開頁。
 * 直接 goto('/en') 只會被 307 導回無前綴網址，然後拿到瀏覽器語系的版本。
 */

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'

/** 把這個 context 之後的請求都切成英文。開頁前呼叫。 */
export async function useEnglish(page: Page): Promise<void> {
  await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: BASE_URL }])
}
