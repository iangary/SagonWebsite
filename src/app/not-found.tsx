import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import '@/styles/globals.css'

export async function generateMetadata() {
  const t = await getTranslations('notFound')
  return { title: t('title') }
}

/**
 * 全域 404。所有前台頁面都在 [locale] 之下，這支只在網址完全不匹配時出現。
 *
 * 專案沒有 app/layout.tsx（[locale] 與 admin 各自是 root layout），
 * 所以這頁由 Next 內建的 DefaultLayout 包起來 —— 它已經提供 html/body，
 * 這裡再寫一次會變成巢狀 html 並造成 hydration 不一致。
 */
export default async function NotFound() {
  const t = await getTranslations('notFound')

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream-50 text-ink-900">
      <div className="px-6 text-center">
        <p className="text-5xl tracking-widest text-taupe-500">404</p>
        <h1 className="mt-4 text-xl">{t('heading')}</h1>
        <p className="mt-2 text-sm text-taupe-600">{t('body')}</p>
        <Link
          href="/"
          className="mt-8 inline-block border border-ink-900 px-6 py-3 text-sm tracking-wide transition-colors hover:bg-ink-900 hover:text-cream-50"
        >
          {t('backHome')}
        </Link>
      </div>
    </div>
  )
}
