import Link from 'next/link'
import '@/styles/globals.css'

export const metadata = { title: '沒有權限', robots: { index: false } }

/** proxy.ts 在非管理員嘗試進入 /admin 時 rewrite 到這裡。html/body 由 Next 的 DefaultLayout 提供。 */
export default function ForbiddenPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-cream-50 text-ink-900">
      <div className="px-6 text-center">
        <p className="text-5xl tracking-widest text-taupe-500">403</p>
        <h1 className="mt-4 text-xl">您沒有權限存取管理後台</h1>
        <p className="mt-2 text-sm text-taupe-600">
          如果您認為這是錯誤，請聯絡管理員確認帳號權限。
        </p>
        <Link
          href="/"
          className="mt-8 inline-block border border-ink-900 px-6 py-3 text-sm tracking-wide transition-colors hover:bg-ink-900 hover:text-cream-50"
        >
          回到首頁
        </Link>
      </div>
    </div>
  )
}
