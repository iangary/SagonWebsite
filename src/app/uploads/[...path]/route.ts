import { NextResponse } from 'next/server'
import { readUpload } from '@/lib/uploads'

export const dynamic = 'force-dynamic'

/**
 * 商品圖片。
 *
 * 檔案就在 `public/uploads/` 底下，看起來多此一舉，但正式模式的 Next 只認得
 * **容器啟動當下**就存在於 public 的檔案，之後才上傳的一律 404
 * —— 完整說明見 `readUpload()` 的註解。這支路由是新上架商品的圖唯一送得出去的路徑。
 *
 * 開機前就存在的舊檔仍會被 public 靜態服務攔下（比對順序在 app route 之前），
 * 兩條路徑送出的是同一個檔案，不衝突。
 *
 * `src/proxy.ts` 的 matcher 已經排除 /uploads，這裡不會經過 next-intl。
 * 商品圖是公開資訊，不驗身分 —— 與存放收件人資料的 /api/admin/labels 不同。
 */
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await params

  const file = await readUpload(segments)
  if (!file) {
    return new NextResponse('Not Found', { status: 404 })
  }

  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      'Content-Type': file.contentType,
      // 檔名是 UUID，內容不會就地更動（改圖等於換一個新檔名），所以可以放心 immutable。
      // 這比 Next 給 public 檔案的 `max-age=0` 好很多：商品頁的圖不會每次進站都重抓。
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
