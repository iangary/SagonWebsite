'use client'

import * as React from 'react'
import { ArrowRight, ChevronDown } from 'lucide-react'
import { Link, usePathname } from '@/i18n/routing'
import { cn } from '@/lib/utils'

type NavLink = { href: string; label: string }

/**
 * 桌機（lg 以上）的主導覽：幾個固定連結 + 一個「選物分類」展開面板。
 *
 * 分類原本整排攤在第二列，後台多加幾個分類就會超出畫面被切掉。
 * 收進面板之後導覽列的寬度固定，分類再多也只是面板裡多一格。
 *
 * 面板在滑鼠移入時打開、移出後稍等一下才關（從按鈕往下移到面板的途中會短暫離開兩者），
 * 點按鈕也能開關，Esc、點連結、換頁都會關閉。面板絕對定位在 <header> 底下，
 * 所以 header 本身必須是定位元素（它是 sticky，已經是）。
 */
export function DesktopNav({
  leading,
  trailing,
  categories,
  labels,
}: {
  /** 分類面板左邊的連結 */
  leading: NavLink[]
  /** 分類面板右邊的連結 */
  trailing: NavLink[]
  categories: NavLink[]
  labels: { nav: string; categories: string; viewAll: string; viewAllHref: string }
}) {
  const pathname = usePathname()
  // 記住面板是在哪一頁打開的：換頁之後 pathname 對不上，面板自然就關了，不需要 effect
  const [openedAt, setOpenedAt] = React.useState<string | null>(null)
  const open = openedAt === pathname
  const setOpen = React.useCallback(
    (next: boolean) => setOpenedAt(next ? pathname : null),
    [pathname],
  )
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const panelId = React.useId()

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
  }
  const openNow = () => {
    cancelClose()
    setOpen(true)
  }
  const closeSoon = () => {
    cancelClose()
    closeTimer.current = setTimeout(() => setOpen(false), 160)
  }

  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  React.useEffect(() => cancelClose, [])

  const categoryActive = categories.some((c) => pathname === c.href)

  return (
    <nav aria-label={labels.nav} className="hidden lg:block">
      <ul className="flex items-center gap-9 text-[13px] tracking-[0.1em]">
        {leading.map((link) => (
          <li key={link.href}>
            <NavItem link={link} active={pathname === link.href} />
          </li>
        ))}

        {categories.length > 0 && (
          <li onMouseEnter={openNow} onMouseLeave={closeSoon}>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => (open ? setOpen(false) : openNow())}
              className={cn(underline, 'flex items-center gap-1', (open || categoryActive) && underlineOn)}
            >
              {labels.categories}
              <ChevronDown
                size={14}
                strokeWidth={1.5}
                className={cn('transition-transform duration-300', open && 'rotate-180')}
              />
            </button>

            <div
              id={panelId}
              hidden={!open}
              className="absolute inset-x-0 top-full border-t border-cream-200 bg-cream-50 shadow-[0_24px_40px_-24px_rgb(43_39_36/0.25)]"
            >
              <div className="mx-auto flex max-w-7xl gap-16 px-6 py-10">
                <ul className="grid flex-1 grid-cols-3 gap-x-10 gap-y-4 text-sm tracking-wide">
                  {categories.map((c) => (
                    <li key={c.href}>
                      <Link
                        href={c.href}
                        onClick={() => setOpen(false)}
                        className={cn(
                          'text-ink-700 transition-colors hover:text-plum-700',
                          pathname === c.href && 'text-plum-700',
                        )}
                      >
                        {c.label}
                      </Link>
                    </li>
                  ))}
                </ul>
                <div className="w-56 shrink-0 border-l border-cream-200 pl-10">
                  <p className="font-display text-xl tracking-[0.08em] text-taupe-600 italic">
                    Sagan Boutique
                  </p>
                  <Link
                    href={labels.viewAllHref}
                    onClick={() => setOpen(false)}
                    className="group mt-4 inline-flex items-center gap-1.5 text-sm text-ink-900 transition-colors hover:text-plum-700"
                  >
                    {labels.viewAll}
                    <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" />
                  </Link>
                </div>
              </div>
            </div>
          </li>
        )}

        {trailing.map((link) => (
          <li key={link.href}>
            <NavItem link={link} active={pathname === link.href} />
          </li>
        ))}
      </ul>
    </nav>
  )
}

/* 滑入時由左往右長出一條梅子色細線；目前所在頁面常駐 */
const underline =
  'relative py-2 text-ink-700 transition-colors hover:text-ink-900 after:absolute after:inset-x-0 after:bottom-0 after:h-px after:origin-left after:scale-x-0 after:bg-plum-600 after:transition-transform after:duration-300 hover:after:scale-x-100'
const underlineOn = 'text-ink-900 after:scale-x-100'

function NavItem({ link, active }: { link: NavLink; active: boolean }) {
  return (
    <Link
      href={link.href}
      aria-current={active ? 'page' : undefined}
      className={cn(underline, 'whitespace-nowrap', active && underlineOn)}
    >
      {link.label}
    </Link>
  )
}
