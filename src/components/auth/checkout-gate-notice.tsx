import type { ReactNode } from 'react'
import { ShoppingBag } from 'lucide-react'

/**
 * 登入／註冊頁上方的提示條 —— 「你是被結帳擋下來才到這裡的」。
 *
 * 沒有這條的話，按了結帳卻突然看到註冊表單會像是網站壞了。
 * 顯示條件見 lib/auth/checkout-gate.ts 的 isCheckoutCallback。
 */
export function CheckoutGateNotice({ children }: { children: ReactNode }) {
  return (
    <p className="mt-8 flex items-start gap-2 border border-cream-300 bg-cream-100 px-4 py-3 text-sm leading-relaxed text-ink-700">
      <ShoppingBag size={15} strokeWidth={1.5} className="mt-0.5 shrink-0 text-taupe-500" />
      {children}
    </p>
  )
}
