'use client'

import * as React from 'react'
import { useSession, signOut } from 'next-auth/react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Search, ShoppingBag, User, LogOut, Package, LayoutDashboard, X } from 'lucide-react'
import { Link, useRouter } from '@/i18n/routing'
import { useCartCount } from '@/components/cart/cart-count-provider'
import { LocaleSwitcher } from './locale-switcher'

type Labels = {
  search: string
  cart: string
  account: string
  login: string
  logout: string
  orderQuery: string
  admin: string
  closeSearch: string
  memberFallback: string
  switchLanguage: string
}

export function HeaderActions({ labels }: { labels: Labels }) {
  const { data: session } = useSession()
  const { count } = useCartCount()
  const [searchOpen, setSearchOpen] = React.useState(false)

  return (
    <div className="flex items-center gap-1">
      <SearchControl
        open={searchOpen}
        onOpenChange={setSearchOpen}
        placeholder={labels.search}
        closeLabel={labels.closeSearch}
      />

      <LocaleSwitcher label={labels.switchLanguage} />

      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          aria-label={labels.account}
          className="flex size-10 items-center justify-center text-ink-700 transition-colors hover:text-taupe-600"
        >
          <User size={19} strokeWidth={1.5} />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            className="z-60 min-w-52 border border-cream-200 bg-white py-1 text-sm shadow-lg"
          >
            {session?.user ? (
              <>
                <div className="border-b border-cream-200 px-4 py-2.5">
                  <p className="truncate text-ink-900">
                    {session.user.name ?? labels.memberFallback}
                  </p>
                  <p className="truncate text-xs text-taupe-500">
                    {session.user.email ?? session.user.phone}
                  </p>
                </div>
                <MenuLink href="/account" icon={<User size={15} />}>
                  {labels.account}
                </MenuLink>
                <MenuLink href="/account/orders" icon={<Package size={15} />}>
                  {labels.orderQuery}
                </MenuLink>
                {session.user.role === 'ADMIN' && (
                  <DropdownMenu.Item asChild>
                    <a
                      href="/admin"
                      className="flex cursor-pointer items-center gap-2.5 px-4 py-2.5 text-ink-700 outline-none data-highlighted:bg-cream-100"
                    >
                      <LayoutDashboard size={15} />
                      {labels.admin}
                    </a>
                  </DropdownMenu.Item>
                )}
                <DropdownMenu.Separator className="my-1 h-px bg-cream-200" />
                <DropdownMenu.Item
                  onSelect={() => signOut({ redirectTo: '/' })}
                  className="flex cursor-pointer items-center gap-2.5 px-4 py-2.5 text-ink-700 outline-none data-highlighted:bg-cream-100"
                >
                  <LogOut size={15} />
                  {labels.logout}
                </DropdownMenu.Item>
              </>
            ) : (
              <>
                <MenuLink href="/login" icon={<User size={15} />}>
                  {labels.login}
                </MenuLink>
                <MenuLink href="/order/query" icon={<Package size={15} />}>
                  {labels.orderQuery}
                </MenuLink>
              </>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <Link
        href="/cart"
        aria-label={labels.cart}
        className="relative flex size-10 items-center justify-center text-ink-700 transition-colors hover:text-taupe-600"
      >
        <ShoppingBag size={19} strokeWidth={1.5} />
        {count > 0 && (
          <span className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-ink-900 px-1 text-[10px] font-medium leading-4 text-cream-50">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </Link>
    </div>
  )
}

function MenuLink({
  href,
  icon,
  children,
}: {
  href: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <DropdownMenu.Item asChild>
      <Link
        href={href}
        className="flex cursor-pointer items-center gap-2.5 px-4 py-2.5 text-ink-700 outline-none data-highlighted:bg-cream-100"
      >
        {icon}
        {children}
      </Link>
    </DropdownMenu.Item>
  )
}

function SearchControl({
  open,
  onOpenChange,
  placeholder,
  closeLabel,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  placeholder: string
  closeLabel: string
}) {
  const router = useRouter()
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const q = inputRef.current?.value.trim()
    if (!q) return
    onOpenChange(false)
    router.push(`/product/all?q=${encodeURIComponent(q)}`)
  }

  if (!open) {
    return (
      <button
        onClick={() => onOpenChange(true)}
        aria-label={placeholder}
        className="flex size-10 items-center justify-center text-ink-700 transition-colors hover:text-taupe-600"
      >
        <Search size={19} strokeWidth={1.5} />
      </button>
    )
  }

  /*
    手機：蓋住整條頁首列（logo、選單都遮掉），右邊那排圖示塞不下一個輸入框，
    塞進去會往左疊到 logo 上。字級 16px —— iOS Safari 對小於 16px 的輸入框
    一聚焦就把整頁放大，放大後 logo 跟購物車都被推出畫面。
    平板以上維持原本的行內展開。
  */
  return (
    <form
      onSubmit={submit}
      role="search"
      className="absolute inset-0 z-10 flex items-center gap-2 bg-cream-50 px-4 sm:static sm:z-auto sm:gap-1 sm:bg-transparent sm:px-0"
    >
      <Search size={18} strokeWidth={1.5} className="shrink-0 text-taupe-500 sm:hidden" aria-hidden />
      <input
        ref={inputRef}
        name="q"
        // 不用 type="search"：瀏覽器會再加一顆自己的清除鈕，跟右邊的關閉鈕變成兩個 ×
        enterKeyHint="search"
        placeholder={placeholder}
        onKeyDown={(e) => e.key === 'Escape' && onOpenChange(false)}
        className="min-w-0 flex-1 border-b border-cream-300 bg-transparent px-1 py-1.5 text-base placeholder:text-taupe-400 focus:border-taupe-500 focus:outline-none sm:w-56 sm:flex-none sm:text-sm"
      />
      <button
        type="button"
        onClick={() => onOpenChange(false)}
        aria-label={closeLabel}
        className="flex size-10 shrink-0 items-center justify-center text-taupe-400 hover:text-ink-900 sm:size-8"
      >
        <X size={18} className="sm:size-4" />
      </button>
    </form>
  )
}
