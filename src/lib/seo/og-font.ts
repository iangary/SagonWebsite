import 'server-only'

/**
 * 給 ImageResponse 用的中文字體。
 *
 * ImageResponse（底層是 satori）不會用專案裡 next/font 載的字體，也讀不到
 * 瀏覽器字體 —— 沒有明確餵字體 buffer 的話，中文會整排變成方框（tofu）。
 *
 * 直接抓完整的 Noto Sans TC 是十幾 MB（CJK 字體本來就大），所以走 Google Fonts
 * 的 `text=` 子集端點：只回傳這幾個字用得到的字形，通常只有幾 KB。
 *
 * 兩個容易踩到的點：
 * 1. satori 不吃 woff2，只吃 ttf／otf／woff。Google Fonts 會依 User-Agent 決定
 *    回哪種格式，所以這裡刻意送一個舊的 UA 字串把它逼回 truetype。
 * 2. 這是容器對外的網路請求。失敗時不能讓整張圖掛掉 —— 呼叫端要能退回
 *    純英文版面（見 opengraph-image.tsx）。
 */

const LEGACY_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_6_8) AppleWebKit/534.30 (KHTML, like Gecko) Version/5.1 Safari/534.30'

/**
 * 依語系挑字族。
 *
 * Noto Sans TC 有假名，但**沒有韓文字母**（Hangul）—— 韓文的圖用它會整排方框。
 * 日文雖然 TC 也能顯示，但漢字是台灣字形，日本讀者一眼看得出來，所以一併換掉。
 */
const OG_FONT_FAMILY: Record<string, string> = {
  ja: 'Noto+Sans+JP',
  ko: 'Noto+Sans+KR',
}

export async function loadNotoSansTcSubset(
  text: string,
  weight: 400 | 600 = 600,
  locale?: string,
): Promise<ArrayBuffer | null> {
  const family = (locale && OG_FONT_FAMILY[locale]) || 'Noto+Sans+TC'
  try {
    const cssUrl =
      `https://fonts.googleapis.com/css2?family=${family}:wght@${weight}` +
      `&text=${encodeURIComponent(text)}`

    const css = await fetch(cssUrl, {
      headers: { 'User-Agent': LEGACY_UA },
      // 字體子集對同一組字是固定的，讓 Next 長期快取，不要每次出圖都連外
      next: { revalidate: 60 * 60 * 24 * 30 },
    }).then((r) => (r.ok ? r.text() : null))

    if (!css) return null

    const match = css.match(/src:\s*url\(([^)]+)\)/)
    if (!match) return null

    const font = await fetch(match[1], { next: { revalidate: 60 * 60 * 24 * 30 } })
    if (!font.ok) return null

    return await font.arrayBuffer()
  } catch (error) {
    // 出圖失敗不該讓分享連結整個沒有圖，記一筆就好
    console.error('[og] 載入中文字體失敗，改用純英文版面', error)
    return null
  }
}
