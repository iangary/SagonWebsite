import 'server-only'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

/**
 * 商品圖片上傳。
 *
 * 幾個刻意的決定：
 *   - **不信任前端傳來的檔名與 MIME**。檔名一律重新產生（UUID），
 *     格式由 sharp 實際解碼後判斷 —— 副檔名改成 .jpg 的惡意檔騙不過解碼。
 *   - **一律轉成 WebP 並限制最長邊**。手機直拍常常是 4000px、5MB 以上，
 *     原檔直接上架會讓商品頁重到不能用。
 *   - **存在本機磁碟**（`public/uploads/`）。正式環境 compose 已經把這個路徑
 *     掛成 docker volume，重建容器不會掉圖。要換 S3/R2 只需改這一個模組。
 *   - **讀取一律走 `readUpload()`，不靠 Next 的 public 靜態服務**。理由見該函式。
 */

/** 單張圖片大小上限。next.config.ts 的 serverActions.bodySizeLimit 是 8mb，留一點餘裕給表單其他欄位。 */
export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024

/** 最長邊上限。睡衣商品圖 1600px 已經足夠放大看細節。 */
const MAX_DIMENSION = 1600

/** 一次最多上傳幾張 */
export const MAX_FILES_PER_UPLOAD = 10

const WEBP_QUALITY = 82

const UPLOAD_ROOT = path.join(process.cwd(), 'public', 'uploads')

/** sharp 能解出這些格式才算是合法圖片 */
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp', 'avif', 'gif', 'tiff'])

export type SavedImage = {
  /** 可直接放進 <Image src> 的公開路徑 */
  url: string
  width: number
  height: number
  bytes: number
}

export type UploadFailure = { filename: string; reason: string }

export type UploadResult = {
  saved: SavedImage[]
  failed: UploadFailure[]
}

function humanSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 把一批上傳的檔案存成商品圖。
 *
 * 單張失敗不會中斷整批 —— 營運一次拉 10 張圖，其中一張壞掉時
 * 應該是「9 張成功、告訴你哪一張不行」，而不是整批退回。
 */
export async function saveProductImages(
  productId: string,
  files: File[],
): Promise<UploadResult> {
  const saved: SavedImage[] = []
  const failed: UploadFailure[] = []

  const accepted = files.filter((f) => f.size > 0).slice(0, MAX_FILES_PER_UPLOAD)
  if (accepted.length === 0) return { saved, failed }

  // 商品 id 來自資料庫（cuid），不會有路徑跳脫字元，但還是做一次防呆
  const safeId = productId.replace(/[^a-zA-Z0-9_-]/g, '')
  if (!safeId) return { saved, failed: [{ filename: '-', reason: '商品識別碼不正確' }] }

  const dir = path.join(UPLOAD_ROOT, 'products', safeId)
  await mkdir(dir, { recursive: true })

  for (const file of accepted) {
    const label = file.name || '(未命名)'

    if (file.size > MAX_UPLOAD_BYTES) {
      failed.push({
        filename: label,
        reason: `檔案 ${humanSize(file.size)} 超過上限 ${humanSize(MAX_UPLOAD_BYTES)}`,
      })
      continue
    }

    try {
      const input = Buffer.from(await file.arrayBuffer())

      // 這一步同時完成「驗證是不是真的圖片」與「取得尺寸」
      const meta = await sharp(input).metadata()
      if (!meta.format || !ACCEPTED_FORMATS.has(meta.format)) {
        failed.push({ filename: label, reason: '不是支援的圖片格式' })
        continue
      }

      const output = await sharp(input)
        .rotate() // 依 EXIF 轉正，否則手機直拍的圖會躺著
        .resize({
          width: MAX_DIMENSION,
          height: MAX_DIMENSION,
          fit: 'inside',
          withoutEnlargement: true, // 小圖不要硬放大，只會變模糊又變大
        })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer({ resolveWithObject: true })

      const filename = `${randomUUID()}.webp`
      await writeFile(path.join(dir, filename), output.data)

      saved.push({
        url: `/uploads/products/${safeId}/${filename}`,
        width: output.info.width,
        height: output.info.height,
        bytes: output.data.length,
      })
    } catch (error) {
      console.error('[upload] 處理圖片失敗', label, error)
      failed.push({ filename: label, reason: '圖片無法解析，可能已損毀' })
    }
  }

  return { saved, failed }
}

/**
 * 可以送出去的副檔名 → Content-Type。
 *
 * 白名單而不是查表失敗就給 octet-stream —— 上傳目錄裡只該有圖片，
 * 萬一哪天有別的東西被寫進去（或是路徑組出了預期外的檔案），
 * 這裡直接當成不存在，而不是把它變成本站網域上的可下載檔案。
 * **`.svg` 刻意不在清單裡**：SVG 可以夾帶 <script>，從自家網域送出去等於儲存型 XSS。
 * 上傳一律轉成 WebP（見 saveProductImages），其餘幾種是舊種子資料 /uploads/seed/ 留下的。
 */
const SERVED_TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
}

export type UploadedFile = { data: Buffer; contentType: string }

/**
 * 讀出上傳目錄裡的圖片，給 `app/uploads/[...path]/route.ts` 送出。
 *
 * **為什麼不直接讓 Next 的 public 靜態服務處理？**
 * 正式模式（`!dev`）下 Next 只在**啟動當下**掃一次 public 目錄，把檔名收進
 * `publicFolderItems` 這個 Set，之後不再重掃也沒有 watcher；命中判斷是
 * `if (matchedItem || opts.dev)`，那段「動態去 fs 確認檔案在不在」的 fallback
 * 註解寫明只給 dev 用（node_modules/next/dist/server/lib/router-utils/filesystem.js）。
 * 也就是說：**容器啟動後才上傳的圖片，正式站永遠 404，重啟容器才會出現**。
 * 而 `npm run dev` 有那個 fallback，所以開發期完全看不出問題。
 *
 * 順帶一提，這道關卡不能改用 Caddy 直接吃 `/uploads/*` 解決 —— `/_next/image`
 * 對本機路徑走的是 image-optimizer 的 `fetchInternalImage()`，它用 mock request
 * 在 Next 進程內部打自己的 router，封包根本不出容器，Caddy 攔不到。
 *
 * 回傳 null 代表 404：檔案不存在、是目錄、或副檔名不在白名單內。
 */
export async function readUpload(segments: string[]): Promise<UploadedFile | null> {
  const root = path.resolve(UPLOAD_ROOT)
  const target = path.resolve(root, ...segments)

  // 網址片段由 Next 解碼後交進來，可能含 ..；解析後再確認仍落在上傳目錄內
  if (!target.startsWith(root + path.sep)) {
    console.warn('[upload] 拒絕讀取上傳目錄外的路徑：', segments.join('/'))
    return null
  }

  const contentType = SERVED_TYPES[path.extname(target).toLowerCase()]
  if (!contentType) return null

  try {
    return { data: await readFile(target), contentType }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    // ENOENT/EISDIR 是正常的 404，不值得留日誌
    if (code !== 'ENOENT' && code !== 'EISDIR') {
      console.error('[upload] 讀取上傳檔案失敗', segments.join('/'), error)
    }
    return null
  }
}

/**
 * 刪除磁碟上的圖片檔。
 *
 * 只接受本站 /uploads/ 底下的路徑，並且解析後再確認一次仍落在上傳目錄內 ——
 * 沒有這道檢查，帶 ../../ 的路徑就能刪掉專案裡任何檔案。
 * 檔案不存在不算錯誤（可能已經被刪過），資料庫那筆照樣要清掉。
 */
export async function deleteUploadedFile(url: string): Promise<void> {
  if (!url.startsWith('/uploads/')) return

  const target = path.resolve(UPLOAD_ROOT, '.' + url.slice('/uploads'.length))
  const root = path.resolve(UPLOAD_ROOT)

  if (target !== root && !target.startsWith(root + path.sep)) {
    console.warn('[upload] 拒絕刪除上傳目錄外的路徑：', url)
    return
  }

  try {
    await unlink(target)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') console.error('[upload] 刪除檔案失敗', url, error)
  }
}

/**
 * 刪除商品時把整個圖片資料夾移除。
 *
 * 只刪檔案的話會留下一堆空目錄，久了很難分辨哪些是還在用的。
 * productId 只允許英數與 - _，組出來的路徑一定在上傳目錄底下。
 */
export async function deleteProductImageDir(productId: string): Promise<void> {
  const safeId = productId.replace(/[^a-zA-Z0-9_-]/g, '')
  if (!safeId) return

  const dir = path.join(UPLOAD_ROOT, 'products', safeId)
  try {
    await rm(dir, { recursive: true, force: true })
  } catch (error) {
    console.error('[upload] 刪除商品圖片目錄失敗', productId, error)
  }
}
