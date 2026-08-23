/**
 * Code 39 條碼產生器。
 *
 * 為什麼需要它：綠界的超商條碼付款只回三段號碼（Barcode1/2/3），
 * **不回條碼圖**，文件明確要求特店自己轉成 Code 39。消費者拿去超商櫃檯是
 * 讓店員刷條碼，所以一定要畫出來，光印號碼沒有用。
 *
 * 純函式、不依賴 DOM，所以能在 Server Component 直接產生 SVG，
 * 也能寫單元測試驗證編碼表。
 */

/**
 * 每個字元對應 9 個元素（bar/space 交替、由 bar 開始），
 * n = 窄、w = 寬。這是 Code 39 的標準編碼表。
 */
const PATTERNS: Record<string, string> = {
  '0': 'nnnwwnwnn',
  '1': 'wnnwnnnnw',
  '2': 'nnwwnnnnw',
  '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw',
  '5': 'wnnwwnnnn',
  '6': 'nnwwwnnnn',
  '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn',
  '9': 'nnwwnnwnn',
  A: 'wnnnnwnnw',
  B: 'nnwnnwnnw',
  C: 'wnwnnwnnn',
  D: 'nnnnwwnnw',
  E: 'wnnnwwnnn',
  F: 'nnwnwwnnn',
  G: 'nnnnnwwnw',
  H: 'wnnnnwwnn',
  I: 'nnwnnwwnn',
  J: 'nnnnwwwnn',
  K: 'wnnnnnnww',
  L: 'nnwnnnnww',
  M: 'wnwnnnnwn',
  N: 'nnnnwnnww',
  O: 'wnnnwnnwn',
  P: 'nnwnwnnwn',
  Q: 'nnnnnnwww',
  R: 'wnnnnnwwn',
  S: 'nnwnnnwwn',
  T: 'nnnnwnwwn',
  U: 'wwnnnnnnw',
  V: 'nwwnnnnnw',
  W: 'wwwnnnnnn',
  X: 'nwnnwnnnw',
  Y: 'wwnnwnnnn',
  Z: 'nwwnwnnnn',
  '-': 'nwnnnnwnw',
  '.': 'wwnnnnwnn',
  ' ': 'nwwnnnwnn',
  $: 'nwnwnwnnn',
  '/': 'nwnwnnnwn',
  '+': 'nwnnnwnwn',
  '%': 'nnnwnwnwn',
  '*': 'nwnnwnwnn', // 起始／結束符號
}

export const CODE39_START_STOP = '*'

/** Code 39 支援的字元集。超出的字元沒有辦法編碼。 */
export function isEncodable(text: string): boolean {
  return text.toUpperCase().split('').every((char) => char in PATTERNS && char !== '*')
}

export interface Code39Bar {
  x: number
  width: number
}

export interface Code39Layout {
  bars: Code39Bar[]
  /** 整個條碼的寬度（以「窄元素」為單位乘上 narrowWidth） */
  width: number
}

/**
 * 算出要畫哪些黑條。
 *
 * 元素從 bar 開始 bar/space 交替，字元之間插入一個窄空白。
 * 寬元素預設是窄元素的 2.5 倍（Code 39 允許 2:1 ~ 3:1，2.5 在多數掃描器上最穩）。
 */
export function layoutCode39(
  text: string,
  options: { narrowWidth?: number; wideRatio?: number } = {},
): Code39Layout {
  const narrow = options.narrowWidth ?? 2
  const wide = narrow * (options.wideRatio ?? 2.5)

  const payload = `${CODE39_START_STOP}${text.toUpperCase()}${CODE39_START_STOP}`
  const bars: Code39Bar[] = []
  let x = 0

  for (let i = 0; i < payload.length; i++) {
    const pattern = PATTERNS[payload[i]]
    if (!pattern) throw new Error(`Code 39 無法編碼的字元：${payload[i]}`)

    for (let j = 0; j < pattern.length; j++) {
      const width = pattern[j] === 'w' ? wide : narrow
      // 偶數位置是黑條，奇數是空白
      if (j % 2 === 0) bars.push({ x, width })
      x += width
    }

    // 字元間隔：一個窄空白（最後一個字元後面不用）
    if (i < payload.length - 1) x += narrow
  }

  return { bars, width: x }
}

/**
 * 產生一張獨立的 SVG 字串。
 *
 * 直接回字串而不是 React 元素，這樣同一份程式也能拿去產生要下載的圖檔
 * （超商繳費單要能存進手機相簿）。
 */
export function code39Svg(
  text: string,
  options: { height?: number; narrowWidth?: number; showText?: boolean } = {},
): string {
  const height = options.height ?? 60
  const showText = options.showText ?? true
  const { bars, width } = layoutCode39(text, { narrowWidth: options.narrowWidth })

  // 兩側留白（quiet zone）至少要 10 倍窄元素寬，否則掃描器讀不到起始符號
  const quiet = (options.narrowWidth ?? 2) * 10
  const textHeight = showText ? 18 : 0
  const totalWidth = width + quiet * 2
  const totalHeight = height + textHeight

  const rects = bars
    .map((bar) => `<rect x="${(bar.x + quiet).toFixed(2)}" y="0" width="${bar.width.toFixed(2)}" height="${height}" />`)
    .join('')

  const label = showText
    ? `<text x="${(totalWidth / 2).toFixed(2)}" y="${totalHeight - 4}" text-anchor="middle" font-family="monospace" font-size="13" letter-spacing="1.5">${escapeXml(text.toUpperCase())}</text>`
    : ''

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth.toFixed(2)}" height="${totalHeight}" ` +
    `viewBox="0 0 ${totalWidth.toFixed(2)} ${totalHeight}" role="img" aria-label="${escapeXml(text)}">` +
    `<rect width="100%" height="100%" fill="#ffffff" />` +
    `<g fill="#000000">${rects}</g>${label}</svg>`
  )
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
