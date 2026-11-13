import { NextResponse } from 'next/server'
import { currentUser, isDbAdmin } from '@/lib/auth'
import { importPostFromHtml } from '@/lib/journal/import-service'
import { PostImportError } from '@/lib/journal/import'

export const dynamic = 'force-dynamic'

/** HTML 檔上限。內嵌 base64 圖片的單一檔案網頁很容易超過 server action 的 8MB，所以走 route handler。 */
const MAX_HTML_BYTES = 40 * 1024 * 1024

/**
 * 匯入一個 HTML 檔成為文章（multipart：file，選填 postId = 覆蓋那篇）。
 *
 * proxy.ts 只擋 /admin，API 路徑不在它的 matcher 裡，這裡必須自己驗身分。
 */
export async function POST(req: Request) {
  const user = await currentUser()
  if (!user || user.role !== 'ADMIN' || !(await isDbAdmin(user.id))) {
    return NextResponse.json({ ok: false, error: '沒有權限' }, { status: 403 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ ok: false, error: '請選擇 HTML 檔' }, { status: 400 })
  }

  const file = form.get('file')
  const postId = String(form.get('postId') ?? '').trim() || undefined
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ ok: false, error: '請選擇 HTML 檔' }, { status: 400 })
  }
  if (file.size > MAX_HTML_BYTES) {
    return NextResponse.json({ ok: false, error: 'HTML 檔超過 40 MB' }, { status: 413 })
  }
  if (!/\.html?$/i.test(file.name) && !file.type.includes('html')) {
    return NextResponse.json({ ok: false, error: '只接受 .html 檔' }, { status: 400 })
  }

  try {
    const html = new TextDecoder('utf-8').decode(await file.arrayBuffer())
    const result = await importPostFromHtml({ html, postId, userId: user.id })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    if (error instanceof PostImportError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 })
    }
    if ((error as Error).message === '找不到這篇文章') {
      return NextResponse.json({ ok: false, error: '找不到這篇文章' }, { status: 404 })
    }
    console.error('[admin] 匯入文章失敗', error)
    return NextResponse.json({ ok: false, error: '匯入失敗，請稍後再試' }, { status: 500 })
  }
}
