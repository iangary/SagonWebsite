'use client'

import * as React from 'react'

/**
 * 手機上狀態頁籤是一排橫滑。點了右邊的頁籤、頁面重新載入後捲軸會回到最左邊，
 * 選中的那顆就跑到畫面外 —— 載入後把它捲進來。
 */
export function StatusTabsScroller({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = React.useRef<HTMLElement>(null)

  React.useEffect(() => {
    const nav = ref.current
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!nav || !active) return
    const overflow = active.offsetLeft + active.offsetWidth - nav.clientWidth
    if (overflow > 0) nav.scrollLeft = overflow + 32
  })

  return (
    <nav ref={ref} aria-label="訂單狀態" className={className}>
      {children}
    </nav>
  )
}
