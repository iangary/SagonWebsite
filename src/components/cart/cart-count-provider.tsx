'use client'

import * as React from 'react'

/**
 * 購物車數量的全域狀態。
 *
 * 刻意不在 layout 讀 cookie 算數量 —— 那會讓每一頁都變成動態渲染，
 * 商品頁就無法靜態化。改成掛載後打一支輕量 API，加入購物車時再手動更新。
 */

const CART_COUNT_EVENT = 'cart:changed'

const CartCountContext = React.createContext<{
  count: number
  refresh: () => void
  setCount: (n: number) => void
} | null>(null)

export function useCartCount() {
  const ctx = React.useContext(CartCountContext)
  if (!ctx) throw new Error('useCartCount 必須在 <CartCountProvider> 之內使用')
  return ctx
}

/** 任何地方改動購物車後呼叫，讓 header 的數字跟上。 */
export function notifyCartChanged(count?: number) {
  window.dispatchEvent(new CustomEvent(CART_COUNT_EVENT, { detail: count }))
}

export function CartCountProvider({ children }: { children: React.ReactNode }) {
  const [count, setCount] = React.useState(0)
  // StrictMode 下 effect 會跑兩次（mount → unmount → mount）。
  // 第一輪那個已卸載的實例若還在等 fetch，回來時 setState 會噴警告，
  // 用這個旗標讓卸載後的回應直接丟掉。
  const alive = React.useRef(true)

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch('/api/cart/count', { cache: 'no-store' })
      if (!res.ok || !alive.current) return
      const data = (await res.json()) as { count: number }
      if (alive.current) setCount(data.count)
    } catch {
      // 網路瞬斷不需要打擾使用者，下次操作會再更新
    }
  }, [])

  React.useEffect(() => {
    alive.current = true
    void refresh()

    function onChanged(e: Event) {
      const detail = (e as CustomEvent<number | undefined>).detail
      if (typeof detail === 'number') setCount(detail)
      else void refresh()
    }

    window.addEventListener(CART_COUNT_EVENT, onChanged)
    return () => {
      alive.current = false
      window.removeEventListener(CART_COUNT_EVENT, onChanged)
    }
  }, [refresh])

  const value = React.useMemo(() => ({ count, refresh, setCount }), [count, refresh])

  return <CartCountContext.Provider value={value}>{children}</CartCountContext.Provider>
}
