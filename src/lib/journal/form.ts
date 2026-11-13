/**
 * 後台文章表單用的小工具（純函式，前後端都能用）。
 */

/**
 * `<input type="datetime-local">` 的值沒有時區。後台使用者都在台灣，
 * 一律當成台北時間解讀 —— 不能交給 `new Date(value)`，那會用伺服器的時區（容器裡常是 UTC），
 * 填「晚上八點發布」會變成隔天凌晨四點。
 */
export function parseTaipeiDateTime(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim())
  if (!match) return null
  const [, y, mo, d, h, mi, s = '00'] = match
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}+08:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

/** 反過來：Date → datetime-local 的值（台北時間）。 */
export function toTaipeiDateTimeInput(date: Date | null | undefined): string {
  if (!date) return ''
  const taipei = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  return taipei.toISOString().slice(0, 16)
}

export const MAX_TAGS = 10
export const MAX_TAG_LENGTH = 20

/**
 * 「穿搭, 新品、 #睡衣」→ ['穿搭', '新品', '睡衣']。
 * 全形逗號、頓號、換行都當分隔；開頭的 # 去掉（習慣打 hashtag 的人很多）；重複的只留一個。
 */
export function parseTags(raw: string): string[] {
  const seen = new Set<string>()
  for (const part of raw.split(/[,，、;；\n]+/)) {
    const tag = part.trim().replace(/^#+/, '').trim().slice(0, MAX_TAG_LENGTH)
    if (tag) seen.add(tag)
    if (seen.size >= MAX_TAGS) break
  }
  return [...seen]
}
