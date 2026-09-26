import { getLocale, getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/routing'
import { db } from '@/lib/db'
import { formatTWD } from '@/lib/utils'
import { localizedName } from '@/lib/i18n/localized'
import { shopName } from '@/lib/shop-config'
import { getShippingSettings } from '@/lib/shop-settings'
import { HeaderActions } from './header-actions'
import { MobileNav } from './mobile-nav'
import { DesktopNav } from './desktop-nav'

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
  const [t, tAnnouncement, locale, categories, shipping] = await Promise.all([
    getTranslations('nav'),
    getTranslations('announcement'),
    getLocale(),
    getNavCategories(),
    getShippingSettings(),
  ])

  const categoryLinks = categories.map((c) => ({
    href: `/category/${c.slug}`,
    label: localizedName(locale, c),
  }))
  const allProducts = { href: '/product/all', label: t('allProducts') }
  const about = { href: '/about', label: t('about') }

  // 手機抽屜是一條直的清單，分類直接攤開；桌機把分類收進 DesktopNav 的展開面板
  const navLinks = [{ href: '/', label: t('home') }, allProducts, about, ...categoryLinks]

  return (
    <header className="sticky top-0 z-50 border-b border-cream-200 bg-cream-50/95 backdrop-blur">
      {/* 公告列：免運門檻 */}
      <div className="bg-ink-900 px-4 py-2 text-center text-xs tracking-wide text-cream-100">
        {tAnnouncement('freeShipping', { amount: formatTWD(shipping.freeShippingThreshold) })}
      </div>

      {/*
        桌機是三欄：logo 靠左、導覽置中、圖示靠右。左右兩欄都 flex-1，導覽才會真的落在正中間。
        分類不再另開第二列（分類一多就被切掉），改收進 DesktopNav 的展開面板。
      */}
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:h-[4.5rem]">
        <div className="flex flex-1 items-center gap-4">
          <MobileNav
            links={navLinks}
            labels={{
              menu: t('menu'),
              open: t('openMenu'),
              close: t('closeMenu'),
              switchLanguage: t('switchLanguage'),
            }}
          />

          <Link href="/" className="shrink-0">
            <span className="font-serif-display text-xl tracking-[0.2em] text-ink-900 sm:text-2xl">
              {shopName(locale)}
            </span>
          </Link>
        </div>

        <DesktopNav
          leading={[allProducts]}
          trailing={[about]}
          categories={categoryLinks}
          labels={{
            nav: t('mainCategories'),
            categories: t('categories'),
            viewAll: t('viewAllProducts'),
            viewAllHref: allProducts.href,
          }}
        />

        <div className="flex flex-1 justify-end">
          <HeaderActions
            labels={{
              search: t('search'),
              cart: t('cart'),
              account: t('account'),
              login: t('login'),
              logout: t('logout'),
              orderQuery: t('orderQuery'),
              admin: t('admin'),
              closeSearch: t('closeSearch'),
              memberFallback: t('memberFallback'),
              switchLanguage: t('switchLanguage'),
            }}
          />
        </div>
      </div>
    </header>
  )
}
