import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { NewPostForm } from './new-post-form'

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
      <p className="mb-8 text-sm text-taupe-600">
        先取個標題建立草稿，接著在編輯頁寫內文、上傳圖片，確認無誤再發布。
      </p>

      <NewPostForm />
    </>
  )
}
