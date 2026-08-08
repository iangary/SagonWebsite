import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/routing'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { formatTWD } from '@/lib/utils'
import { HeaderActions } from './header-actions'
import { MobileNav } from './mobile-nav'

/**
 * 導覽列要顯示的分類（只取頂層，依 sortOrder）。
 *
 * 刻意不加快取。這是一個走索引、最多回 12 列的查詢，
 * 在這個規模下省下來的時間可以忽略，但加了快取就得處理失效與陳舊 ——
 * 後台改完分類卻要等幾分鐘才看到，對營運是很差的體驗。
 *
 * 資料庫連不上時回空陣列 —— 分類列少幾個連結，總比整頁 500 好。
 */
async function getNavCategories() {
  try {
    return await db.category.findMany({
      where: { parentId: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, slug: true, name: true, nameEn: true },
      take: 12,
    })
  } catch (error) {
    console.error('[header] 取得分類失敗', error)
    return []
  }
}

export async function SiteHeader() {
  const [t, categories] = await Promise.all([getTranslations('nav'), getNavCategories()])

  const navLinks = [
    { href: '/', label: t('home') },
    { href: '/product/all', label: t('allProducts') },
    { href: '/about', label: t('about') },
    ...categories.map((c) => ({ href: `/category/${c.slug}`, label: c.name })),
  ]

  return (
    <header className="sticky top-0 z-50 border-b border-cream-200 bg-cream-50/95 backdrop-blur">
      {/* 公告列：免運門檻 */}
      <div className="bg-ink-900 px-4 py-2 text-center text-xs tracking-wide text-cream-100">
        全站消費滿 {formatTWD(env.FREE_SHIPPING_THRESHOLD)} 免運費
      </div>

      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <MobileNav links={navLinks} />

        <Link href="/" className="shrink-0">
          <span className="font-serif-display text-xl tracking-[0.2em] text-ink-900 sm:text-2xl">
            {env.SHOP_NAME}
          </span>
        </Link>

        <div className="flex-1" />

        <HeaderActions
          labels={{
            search: t('search'),
            cart: t('cart'),
            account: t('account'),
            login: t('login'),
            logout: t('logout'),
            orderQuery: t('orderQuery'),
            admin: t('admin'),
          }}
        />
      </div>

      {/* 桌機的分類列 */}
      <nav aria-label="主要分類" className="hidden border-t border-cream-200 lg:block">
        <ul className="no-scrollbar mx-auto flex max-w-7xl items-center gap-7 overflow-x-auto px-6 py-3 text-[13px] tracking-wide">
          {navLinks.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="whitespace-nowrap text-ink-700 transition-colors hover:text-taupe-600"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  )
}
