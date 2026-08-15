import { defaultLocale } from '@/i18n/config'

/**
 * 資料庫欄位的語系挑選。
 *
 * 商品、分類、Banner 這些內容存在資料庫裡，翻不到 messages/*.json。
 * 慣例是「中文欄位必填、英文欄位選填」，所以這裡的規則只有一條：
 * 非預設語系且英文欄位有值才用英文，否則退回中文。
 *
 * 刻意不吐空字串 —— 後台把英文名清空時，寧可顯示中文也不要顯示空白。
 */
export function pickLocalized(
  locale: string,
  fallback: string,
  english: string | null | undefined,
): string {
  if (locale === defaultLocale) return fallback
  const trimmed = english?.trim()
  return trimmed ? trimmed : fallback
}

/** `{ name, nameEn }` 這種常見形狀的捷徑。 */
export function localizedName(
  locale: string,
  entity: { name: string; nameEn?: string | null },
): string {
  return pickLocalized(locale, entity.name, entity.nameEn)
}
