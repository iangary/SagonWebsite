'use client'

import dynamic from 'next/dynamic'
import { Component, useEffect, useState, type ReactNode } from 'react'

/*
 * 絲綢層的閘門。page.tsx（Server Component）只 import 這一個入口；
 * three.js 的 chunk 要等所有閘門都放行才開始下載：
 *
 *   1. prefers-reduced-motion → 永不載入，維持 Banner 圖
 *   2. navigator.connection.saveData → 同上
 *   3. requestIdleCallback（timeout 2.5s）→ 確保 Hero <Image> 的 LCP 先完成
 *   4. WebGL 建立失敗 → error boundary 收掉，畫面回到 Banner 圖
 *
 * ssr:false 只能寫在 Client Component 裡（Next 16 限制），這正是本檔存在的理由。
 */
const SilkCanvas = dynamic(() => import('./silk-canvas'), { ssr: false })

class SilkErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

export function HeroVisual() {
  const [ready, setReady] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const nav = navigator as Navigator & { connection?: { saveData?: boolean } }
    if (nav.connection?.saveData) return

    // Safari 沒有 requestIdleCallback，退回固定延遲
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(() => setReady(true), { timeout: 2500 })
      return () => window.cancelIdleCallback(id)
    }
    const id = setTimeout(() => setReady(true), 1800)
    return () => clearTimeout(id)
  }, [])

  if (!ready) return null

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 transition-opacity duration-1000"
      // 65% 不透明度的半透明疊加：絲綢在上面流動，Banner 圖仍隱約透出
      style={{ opacity: loaded ? 0.65 : 0 }}
    >
      <SilkErrorBoundary>
        <SilkCanvas onFirstFrame={() => setLoaded(true)} />
      </SilkErrorBoundary>
    </div>
  )
}
