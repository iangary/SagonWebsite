/**
 * 後台列表的下單時間：今天、昨天只寫時刻，今年寫月/日，更早的才寫年份。
 * 店家看列表要的是「這張是不是剛進來的」，不是精確到秒的時間戳 —— 精確時間在訂單明細頁。
 *
 * 一律以台北時間判斷「今天」，不吃伺服器時區（容器的 TZ 設定漏了也不會跑掉）。
 */
const TIME_ZONE = 'Asia/Taipei'

const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function partsOf(date: Date) {
  const parts = Object.fromEntries(
    partsFormatter.formatToParts(date).map((p) => [p.type, p.value]),
  ) as Record<string, string>
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    time: `${parts.hour}:${parts.minute}`,
  }
}

/** 台北的日曆日，換成可以相減的天數 */
function dayNumber(p: { year: number; month: number; day: number }) {
  return Date.UTC(p.year, p.month - 1, p.day) / 86_400_000
}

export function formatOrderTime(date: Date, now: Date = new Date()): string {
  const d = partsOf(date)
  const n = partsOf(now)
  const daysAgo = dayNumber(n) - dayNumber(d)
  if (daysAgo === 0) return `今天 ${d.time}`
  if (daysAgo === 1) return `昨天 ${d.time}`
  if (d.year === n.year) return `${d.month}/${d.day} ${d.time}`
  return `${d.year}/${d.month}/${d.day}`
}
