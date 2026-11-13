import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { NewPostForm } from './new-post-form'
import { ImportHtml } from '../import-html'

export const metadata = { title: '新增文章' }

export default function NewPostPage() {
  return (
    <>
      <Link
        href="/admin/journal"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-taupe-600 hover:text-ink-900"
      >
        <ArrowLeft size={14} />
        回文章列表
      </Link>

      <h1 className="mb-2 text-xl tracking-[0.1em]">新增文章</h1>
      <div className="grid max-w-4xl gap-6 lg:grid-cols-2">
        <section className="border border-cream-200 bg-white p-5">
          <h2 className="mb-2 text-sm tracking-[0.1em]">直接匯入 HTML 檔</h2>
          <p className="mb-4 text-xs leading-relaxed text-taupe-500">
            一個檔案就做好整篇：標題、摘要、標籤、封面、內文、譯文都從檔案裡讀，圖片會自動存到網站上，不用另外上傳。
            檔案沒寫狀態的話會存成草稿。格式見「下載範本」。
          </p>
          <ImportHtml />
        </section>

        <section className="border border-cream-200 bg-white p-5">
          <h2 className="mb-2 text-sm tracking-[0.1em]">或從空白開始</h2>
          <p className="mb-4 text-xs leading-relaxed text-taupe-500">
            先取個標題建立草稿，接著在編輯頁寫內文、上傳圖片，確認無誤再發布。
          </p>
          <NewPostForm />
        </section>
      </div>
    </>
  )
}
