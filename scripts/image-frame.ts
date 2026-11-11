/**
 * 蝦皮商品圖的兩種「不要的圖」判斷：外框與尺寸表。純函式，吃縮小後的 RGB 像素。
 *
 * 外框：賣場很多主圖是「米色底 + 四角品牌 logo + 中間一張照片」，或灰底模特兒照左右補白邊成正方形。
 *   官網要的是中間那張照片。判斷方式：
 *   1. 最外圈像素的中位數當底色，且至少兩條邊幾乎全是底色
 *   2. 找出非底色像素最集中的矩形（照片）
 *   3. 照片四條邊必須是「實的」—— 白底去背的衣服也會被框出一個範圍，但它的外輪廓碰不滿邊，
 *      靠這條排除，否則會把去背商品圖裁成只剩衣服
 *   4. 矩形以外幾乎都是底色（logo 只佔一點點）
 *
 * 尺寸表：韓國品牌的尺寸圖是白底灰線稿 + 表格，幾乎全白、完全沒有彩色、中間調很少。
 *   模特兒照即使是白底也有大量膚色、衣服的彩色與陰影的中間調。
 */

export type Rgb = { data: Uint8Array | Buffer; width: number; height: number }
export type Rect = { left: number; top: number; width: number; height: number }

/**
 * 與底色差多少算「不是底色」。框的底色是乾淨的平塗（例如 255,252,239），雜訊只有 ±2 左右；
 * 照片邊緣常是米白牆面或床單，跟框只差幾個色階 —— 放到 12 會把那條邊當成底色而漏判。
 */
const BG_TOLERANCE = 6
/** 圖片的一條邊至少這個比例是底色，才算「底色邊」 */
const MIN_RING_BG = 0.85
/** 照片的每條邊至少這個比例不是底色 */
const MIN_EDGE_SOLID = 0.8
/** 照片外面至少這個比例是底色（其餘是 logo、文字） */
const MIN_OUTSIDE_BG = 0.85
/** 框至少要有這麼寬（佔邊長）才值得裁；太窄的多半只是照片本身的白邊 */
const MIN_MARGIN = 0.03

function pixel(img: Rgb, x: number, y: number): [number, number, number] {
  const i = (y * img.width + x) * 3
  return [img.data[i], img.data[i + 1], img.data[i + 2]]
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[sorted.length >> 1]
}

/** 最長的連續 true 區段 [start, end)，回傳 null 表示沒有 */
function longestRun(flags: boolean[]): [number, number] | null {
  let best: [number, number] | null = null
  let start = -1
  for (let i = 0; i <= flags.length; i++) {
    if (i < flags.length && flags[i]) {
      if (start < 0) start = i
    } else if (start >= 0) {
      if (!best || i - start > best[1] - best[0]) best = [start, i]
      start = -1
    }
  }
  return best
}

/** 回傳照片所在的矩形（以輸入圖的像素為單位），沒有框回傳 null */
export function detectFrame(img: Rgb): Rect | null {
  const { width: w, height: h } = img

  const ring: [number, number, number][] = []
  for (let x = 0; x < w; x++) ring.push(pixel(img, x, 0), pixel(img, x, h - 1))
  for (let y = 1; y < h - 1; y++) ring.push(pixel(img, 0, y), pixel(img, w - 1, y))
  const bg = [0, 1, 2].map((c) => median(ring.map((p) => p[c])))
  const isBgColor = (p: [number, number, number]) =>
    Math.abs(p[0] - bg[0]) <= BG_TOLERANCE &&
    Math.abs(p[1] - bg[1]) <= BG_TOLERANCE &&
    Math.abs(p[2] - bg[2]) <= BG_TOLERANCE
  // 至少兩條邊幾乎全是底色。補白邊的照片常常上下頂到邊，只有左右兩條是底色
  const sides = [
    Array.from({ length: w }, (_, x) => pixel(img, x, 0)),
    Array.from({ length: w }, (_, x) => pixel(img, x, h - 1)),
    Array.from({ length: h }, (_, y) => pixel(img, 0, y)),
    Array.from({ length: h }, (_, y) => pixel(img, w - 1, y)),
  ]
  const bgSides = sides.filter((s) => s.filter(isBgColor).length / s.length >= MIN_RING_BG).length
  if (bgSides < 2) return null

  const fg = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) fg[y * w + x] = isBgColor(pixel(img, x, y)) ? 0 : 1
  }

  // 照片的欄：直向有一大段不是底色（logo 欄只有一小段）
  const colFrac = Array.from({ length: w }, (_, x) => {
    let n = 0
    for (let y = 0; y < h; y++) n += fg[y * w + x]
    return n / h
  })
  const xs = longestRun(colFrac.map((f) => f >= 0.4))
  if (!xs) return null
  const [x0, x1] = xs

  // 在照片的欄範圍內找列
  const rowFrac = Array.from({ length: h }, (_, y) => {
    let n = 0
    for (let x = x0; x < x1; x++) n += fg[y * w + x]
    return n / (x1 - x0)
  })
  const ys = longestRun(rowFrac.map((f) => f >= 0.6))
  if (!ys) return null
  const [y0, y1] = ys

  const margins = [x0 / w, (w - x1) / w, y0 / h, (h - y1) / h]
  if (Math.max(...margins) < MIN_MARGIN) return null
  if ((x1 - x0) * (y1 - y0) < w * h * 0.25) return null

  // 四條邊要是實的（貼齊圖片邊緣的那一側不必檢查）
  const solid = (pts: [number, number][]) => pts.filter(([x, y]) => fg[y * w + x]).length / pts.length
  const span = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i)
  const inset = 1
  const edges: [margin: number, pts: [number, number][]][] = [
    [margins[0], span(y0, y1).map((y) => [x0 + inset, y])],
    [margins[1], span(y0, y1).map((y) => [x1 - 1 - inset, y])],
    [margins[2], span(x0, x1).map((x) => [x, y0 + inset])],
    [margins[3], span(x0, x1).map((x) => [x, y1 - 1 - inset])],
  ]
  for (const [margin, pts] of edges) {
    if (margin > 0.01 && solid(pts) < MIN_EDGE_SOLID) return null
  }

  let outside = 0
  let outsideBg = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= x0 && x < x1 && y >= y0 && y < y1) continue
      outside++
      if (!fg[y * w + x]) outsideBg++
    }
  }
  if (outside > 0 && outsideBg / outside < MIN_OUTSIDE_BG) return null

  return { left: x0, top: y0, width: x1 - x0, height: y1 - y0 }
}

/**
 * 白底灰線稿的尺寸表。
 * 深色像素（黑字）的比例是關鍵：同樣幾乎全白、沒有彩色的還有「官方授權販售」淺灰字卡（沒有黑字）
 * 與白底銀飾照（黑色部分比尺寸表多）。門檻取自 2026-11 匯出檔 180 張尺寸表：0.001–0.0121。
 */
export function isSizeChart(img: Rgb): boolean {
  let white = 0
  let colored = 0
  let midtone = 0
  let dark = 0
  const total = img.width * img.height
  for (let i = 0; i < img.data.length; i += 3) {
    const r = img.data[i]
    const g = img.data[i + 1]
    const b = img.data[i + 2]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (min > 235) white++
    if (max - min > 40) colored++
    if (max > 120 && max < 225) midtone++
    if (max < 90) dark++
  }
  return (
    white / total > 0.88 &&
    colored / total < 0.005 &&
    midtone / total < 0.07 &&
    dark / total >= 0.0005 &&
    dark / total <= 0.014
  )
}
