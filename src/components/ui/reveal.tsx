'use client'

import { useEffect, useRef, type ReactNode } from 'react'

/*
 * 進視窗才漸現的包裝。搭配 globals.css 的「JS 閘門」設計：
 * SSR 輸出預設可見，這裡掛載後才把 <html> 切成 .js-reveal 啟用隱藏初始態，
 * 所以無 JS、爬蟲與 e2e 的可見性斷言都不受影響。
 */

let observer: IntersectionObserver | null = null

function observe(el: Element) {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible')
          observer?.unobserve(entry.target)
        }
      }
    },
    { threshold: 0.15, rootMargin: '0px 0px -10% 0px' },
  )
  observer.observe(el)
}

export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode
  /** 進場延遲（毫秒），給同排卡片做出時間差 */
  delay?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // 減少動態偏好下不啟用閘門，CSS 那側也有同樣的保險
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    document.documentElement.classList.add('js-reveal')
    const el = ref.current
    if (el) observe(el)
    return () => {
      if (el) observer?.unobserve(el)
    }
  }, [])

  return (
    <div
      ref={ref}
      data-reveal
      className={className}
      style={delay ? ({ '--reveal-delay': `${delay}ms` } as React.CSSProperties) : undefined}
    >
      {children}
    </div>
  )
}
