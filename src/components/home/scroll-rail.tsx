'use client'

import * as React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 橫向滑動的一排卡片（首頁品牌櫥窗用）。
 *
 * 手機直接用手指滑；桌機的滑鼠沒辦法橫向捲動，所以 sm 以上在左右兩側補箭頭，
 * 一次捲過約一個畫面寬。捲到頭尾時那一側的箭頭會收起來。
 * 卡片本身由 Server Component 以 children 傳進來，這裡只管捲動。
 */
export function ScrollRail({
  children,
  labels,
  className,
}: {
  children: React.ReactNode
  labels: { prev: string; next: string }
  className?: string
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [edges, setEdges] = React.useState({ start: true, end: false })

  const measure = React.useCallback(() => {
    const el = ref.current
    if (!el) return
    // 留 2px 容差：捲動位置在部分縮放比例下會是小數
    setEdges({
      start: el.scrollLeft <= 2,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2,
    })
  }, [])

  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', measure)
      observer.disconnect()
    }
  }, [measure])

  const scroll = (direction: 1 | -1) => {
    const el = ref.current
    if (!el) return
    el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: 'smooth' })
  }

  return (
    <div className="relative">
      <div
        ref={ref}
        className={cn('no-scrollbar flex snap-x snap-mandatory overflow-x-auto', className)}
      >
        {children}
      </div>
      <RailButton side="left" label={labels.prev} hidden={edges.start} onClick={() => scroll(-1)}>
        <ChevronLeft size={18} strokeWidth={1.5} />
      </RailButton>
      <RailButton side="right" label={labels.next} hidden={edges.end} onClick={() => scroll(1)}>
        <ChevronRight size={18} strokeWidth={1.5} />
      </RailButton>
    </div>
  )
}

function RailButton({
  side,
  label,
  hidden,
  onClick,
  children,
}: {
  side: 'left' | 'right'
  label: string
  hidden: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  // 捲到頭的那一側直接收起來（而不是變灰停用），畫面上不留沒作用的按鈕
  if (hidden) return null
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        'absolute top-1/2 hidden size-11 -translate-y-1/2 items-center justify-center bg-cream-50/90 text-ink-900 shadow-sm backdrop-blur-sm transition-colors hover:bg-cream-50 hover:text-plum-700 sm:flex',
        side === 'left' ? 'left-3' : 'right-3',
      )}
    >
      {children}
    </button>
  )
}
