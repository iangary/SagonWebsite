/**
 * 台灣郵遞區號工具。
 *
 * 只做「判斷縣市」與「是否離島」兩件事 —— 這是黑貓宅急便申報運費距離
 * （綠界 CreateShipment 的 Distance 參數）唯一需要的資訊，
 * 不是一份完整的地址資料庫，不要拿來當門牌驗證用。
 */

interface ZipRange {
  readonly from: number
  readonly to: number
  readonly city: string
}

/**
 * 郵遞區號前三碼 → 縣市。
 *
 * ⚠️ 連江縣（209–212）夾在新北市的 200 號段中間，所以新北市被拆成兩段。
 * 把 200–253 當成一整段是這張表最容易犯的錯，而且錯的正好是離島 ——
 * 該申報 02 卻報成 00/01，運費會對不上。
 */
const ZIP_RANGES: readonly ZipRange[] = [
  { from: 100, to: 116, city: '台北市' },
  { from: 200, to: 206, city: '基隆市' },
  { from: 207, to: 208, city: '新北市' },
  { from: 209, to: 212, city: '連江縣' },
  { from: 220, to: 253, city: '新北市' },
  { from: 260, to: 272, city: '宜蘭縣' },
  { from: 300, to: 300, city: '新竹市' },
  { from: 302, to: 315, city: '新竹縣' },
  { from: 320, to: 338, city: '桃園市' },
  { from: 350, to: 369, city: '苗栗縣' },
  { from: 400, to: 439, city: '台中市' },
  { from: 500, to: 530, city: '彰化縣' },
  { from: 540, to: 558, city: '南投縣' },
  { from: 600, to: 600, city: '嘉義市' },
  { from: 602, to: 625, city: '嘉義縣' },
  { from: 630, to: 655, city: '雲林縣' },
  { from: 700, to: 745, city: '台南市' },
  { from: 800, to: 852, city: '高雄市' },
  { from: 880, to: 885, city: '澎湖縣' },
  { from: 890, to: 896, city: '金門縣' },
  { from: 900, to: 947, city: '屏東縣' },
  { from: 950, to: 966, city: '台東縣' },
  { from: 970, to: 983, city: '花蓮縣' },
]

/** 取前三碼。六碼的 3+3 郵遞區號也吃得下。 */
function zip3(zip: string): number | null {
  const head = zip.trim().slice(0, 3)
  if (!/^\d{3}$/.test(head)) return null
  return Number.parseInt(head, 10)
}

export function zipToCity(zip: string): string | null {
  const code = zip3(zip)
  if (code === null) return null
  return ZIP_RANGES.find((range) => code >= range.from && code <= range.to)?.city ?? null
}

/** 整縣都是離島的三個縣 */
const ISLAND_CITIES = new Set(['澎湖縣', '金門縣', '連江縣'])

/** 本島縣份底下的離島鄉：屏東琉球、台東綠島、台東蘭嶼 */
const ISLAND_ZIP3 = new Set([929, 951, 952])

export function isOutlyingIsland(zip: string): boolean {
  const code = zip3(zip)
  if (code === null) return false
  if (ISLAND_ZIP3.has(code)) return true

  const city = zipToCity(zip)
  return city !== null && ISLAND_CITIES.has(city)
}

/** 綠界 Distance：00 同縣市、01 外縣市、02 離島 */
export type TcatDistance = '00' | '01' | '02'

/**
 * 黑貓宅急便的運費距離代碼。
 *
 * 認不出郵遞區號時回 01（外縣市）—— 寧可多報一級也不要少報。
 * 少報成同縣市會被綠界事後更正並補收差額，帳目就對不起來了。
 */
export function tcatDistance(senderZip: string, receiverZip: string): TcatDistance {
  if (isOutlyingIsland(receiverZip)) return '02'

  const from = zipToCity(senderZip)
  const to = zipToCity(receiverZip)
  if (from === null || to === null) return '01'

  return from === to ? '00' : '01'
}
