import 'server-only'
import { lookup } from 'node:dns/promises'
import net from 'node:net'
import { MAX_UPLOAD_BYTES, savePostImages } from '@/lib/uploads'

/**
 * 匯入文章時把圖片「落地」到 /uploads/posts/{postId}/，管理員不必另外上傳：
 *
 *   data:image/…;base64,…   → 解碼後存檔（Word / 部分編輯器「單一檔案網頁」就是這樣內嵌圖片）
 *   http(s)://…             → 由伺服器下載後存檔（外站圖會失效、會被防盜連，不能一直借用）
 *   /uploads/…、其他站內路徑 → 原樣保留
 *   其他（images/a.jpg、file:、blob:） → 作者電腦上的檔案，伺服器拿不到，移除並提醒
 *
 * 存檔一律走 savePostImages：用 sharp 實際解碼驗證、轉 WebP、限制尺寸，
 * 跟後台手動上傳同一套規則（假圖片、SVG 進不來）。
 *
 * 外部下載只給管理員用（呼叫端已驗權），仍然擋掉內網位址，避免被拿來打容器內部服務：
 * 解析 DNS 後任何一個位址落在私有／保留網段就拒絕，轉址也逐跳重新檢查。
 */

/** 一篇文章最多處理幾張圖（含譯文） */
export const MAX_IMPORT_IMAGES = 60
const DOWNLOAD_TIMEOUT_MS = 15_000
const MAX_REDIRECTS = 3

export type ImageLocalization = {
  /** 原始 src → 新網址；null = 移除這張圖。沒列在裡面的保持原樣。 */
  map: Map<string, string | null>
  saved: number
  warnings: string[]
}

export async function localizeImages(postId: string, srcs: string[]): Promise<ImageLocalization> {
  const map = new Map<string, string | null>()
  const warnings: string[] = []
  let saved = 0
  let localMissing = 0

  const unique = [...new Set(srcs)]
  if (unique.length > MAX_IMPORT_IMAGES) {
    warnings.push(`圖片超過 ${MAX_IMPORT_IMAGES} 張，只處理前 ${MAX_IMPORT_IMAGES} 張`)
  }

  for (const src of unique.slice(0, MAX_IMPORT_IMAGES)) {
    if (src.startsWith('/') && !src.startsWith('//')) continue // 站內路徑

    if (src.startsWith('data:')) {
      const decoded = decodeDataUrl(src)
      if (!decoded) {
        map.set(src, null)
        warnings.push('有一張內嵌圖片不是 base64 圖片，已移除')
        continue
      }
      const url = await save(postId, decoded, `inline-${saved + 1}`, warnings)
      map.set(src, url)
      if (url) saved++
      continue
    }

    if (/^https?:\/\//i.test(src)) {
      try {
        const data = await downloadPublicImage(src)
        const url = await save(postId, data, fileNameOf(src), warnings)
        // 存不起來（不是圖片）就保留原網址，至少前台還看得到
        if (url) {
          map.set(src, url)
          saved++
        }
      } catch (error) {
        warnings.push(`下載不到圖片 ${shorten(src)}（${(error as Error).message}），保留原網址`)
      }
      continue
    }

    map.set(src, null)
    localMissing++
  }

  if (localMissing > 0) {
    warnings.push(
      `有 ${localMissing} 張圖片指向作者電腦上的檔案（例如 images/a.jpg），伺服器拿不到，已移除。` +
        '請把圖片內嵌在 HTML 裡（base64）或改用網址。',
    )
  }

  return { map, saved, warnings }
}

async function save(postId: string, data: Buffer, name: string, warnings: string[]): Promise<string | null> {
  const { saved, failed } = await savePostImages(postId, [new File([new Uint8Array(data)], name)])
  if (saved[0]) return saved[0].url
  warnings.push(`圖片 ${name} 無法使用：${failed[0]?.reason ?? '不是支援的圖片格式'}`)
  return null
}

function decodeDataUrl(src: string): Buffer | null {
  const match = /^data:image\/[a-z0-9.+-]+;base64,([\s\S]*)$/i.exec(src)
  if (!match) return null
  const buf = Buffer.from(match[1]!.replace(/\s+/g, ''), 'base64')
  return buf.length > 0 ? buf : null
}

async function downloadPublicImage(url: string, hops = 0): Promise<Buffer> {
  const target = new URL(url)
  if (target.protocol !== 'https:' && target.protocol !== 'http:') throw new Error('網址格式不支援')
  if (target.username || target.password) throw new Error('網址不能帶帳號密碼')
  await assertPublicHost(target.hostname)

  const res = await fetch(target, {
    redirect: 'manual',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    headers: { accept: 'image/*' },
  })

  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location')
    if (!location || hops >= MAX_REDIRECTS) throw new Error('轉址太多次')
    return downloadPublicImage(new URL(location, target).toString(), hops + 1)
  }
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > MAX_UPLOAD_BYTES) throw new Error('檔案太大')

  // 邊讀邊算，不相信 content-length
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    total += chunk.byteLength
    if (total > MAX_UPLOAD_BYTES) throw new Error('檔案太大')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, '')
  const addresses = net.isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address)
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) throw new Error('不能從內部網路位址下載')
}

/** 私有、迴路、鏈路本地、保留網段（含雲端 metadata 169.254.169.254）。 */
export function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number) as [number, number]
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    )
  }
  const v6 = address.toLowerCase()
  if (v6 === '::' || v6 === '::1') return true
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6)
  if (mapped) return isPrivateAddress(mapped[1]!)
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v6)
}

function fileNameOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() || 'image').slice(0, 80)
  } catch {
    return 'image'
  }
}

function shorten(url: string): string {
  return url.length > 60 ? `${url.slice(0, 57)}…` : url
}
