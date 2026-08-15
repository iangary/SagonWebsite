import 'server-only'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * 託運單 PDF 的落地儲存。
 *
 * 刻意**不放** public/uploads —— 託運單上印著收件人的姓名、地址、電話，
 * 放在公開目錄等於任何人猜到檔名就能撈走客戶個資。
 * 這裡存在 storage/ 底下，只能透過驗過身分的 admin route 讀出來。
 *
 * 部署要記得把 storage/ 掛成 volume，否則重建容器託運單就沒了 ——
 * 而黑貓的 FileNo 只有 24 小時，過期就補印不回來。見 docs/deploy.md。
 */

const LABEL_ROOT = path.join(process.cwd(), 'storage', 'labels')

/** 檔名只由訂單編號組成，先濾成安全字元。 */
function safeName(orderNo: string): string {
  return orderNo.replace(/[^a-zA-Z0-9_-]/g, '')
}

/**
 * 存檔並回傳「相對於 storage/labels 的路徑」。
 * 資料庫只存相對路徑，這樣搬機器或改掛載點都不用改資料。
 */
export async function saveLabel(orderNo: string, pdf: Buffer): Promise<string> {
  const name = safeName(orderNo)
  if (!name) throw new Error(`訂單編號無法組出安全的檔名：${orderNo}`)

  await mkdir(LABEL_ROOT, { recursive: true })
  const relative = `${name}.pdf`
  await writeFile(path.join(LABEL_ROOT, relative), pdf)
  return relative
}

/**
 * 讀回託運單。
 *
 * 即使 labelPath 是我們自己寫進資料庫的，解析後仍要再確認一次落在 storage/labels 內 ——
 * 這條路徑最終來自 orderNo，少了這道檢查，一個帶 ../ 的值就能讀走伺服器上任何檔案。
 * 做法與 deleteUploadedFile 的防穿越檢查一致。
 */
export async function readLabel(relativePath: string): Promise<Buffer | null> {
  const target = path.resolve(LABEL_ROOT, relativePath)
  const root = path.resolve(LABEL_ROOT)

  if (!target.startsWith(root + path.sep)) {
    console.warn('[tcat] 拒絕讀取託運單目錄外的路徑：', relativePath)
    return null
  }

  try {
    return await readFile(target)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') console.error('[tcat] 讀取託運單失敗', relativePath, error)
    return null
  }
}
