'use client'

import * as React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useTranslations } from 'next-intl'
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut } from 'lucide-react'
import { cn } from '@/lib/utils'

export type LightboxImage = { src: string; alt: string }

/**
 * 全螢幕看圖（受控元件：開關與第幾張由呼叫端決定，商品圖庫才能和檢視器同步）。
 *
 * 先「整張塞進畫面」，再點一下切到「放大」：寬度取原圖寬與畫面上兩倍中較大的一個，
 * 以點下去的位置為中心展開，之後用捲動（手機用手指拖）看各處。手機也可以直接雙指縮放，
 * Radix 的捲動鎖有開 allowPinchZoom。
 *
 * 多張時：左右箭頭、鍵盤 ← →、手機左右滑都能換張，底部顯示「3 / 16」。
 * 放大狀態下方向鍵與拖曳是用來捲動圖片的，不換張。
 *
 * 用一般 <img> 載原檔而不是 next/image：next/image 依 sizes 挑的寬度在手機上比原圖小，
 * 放大後就糊了；原檔只在打開時才下載。背景用米白而不是黑：有些圖是透明底的黑色線稿。
 */
export function ImageLightbox({
  images,
  index,
  onIndexChange,
  open,
  onOpenChange,
}: {
  images: LightboxImage[]
  index: number
  onIndexChange?: (index: number) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslations('common')
  const [zoomed, setZoomed] = React.useState(false)
  const [zoomWidth, setZoomWidth] = React.useState(0)
  const scrollerRef = React.useRef<HTMLDivElement>(null)
  const fitRef = React.useRef<HTMLImageElement>(null)
  // 放大後要捲到哪：點下去那一點在圖上的比例、它在畫面上的位置，以及放大後的圖高
  const anchor = React.useRef<{ fx: number; fy: number; x: number; y: number; h: number } | null>(
    null,
  )
  const touchStart = React.useRef<{ x: number; y: number } | null>(null)

  const total = images.length
  const current = images[Math.min(Math.max(index, 0), total - 1)]
  const multiple = total > 1

  const close = () => {
    setZoomed(false)
    onOpenChange(false)
  }

  const step = (delta: number) => {
    if (!multiple) return
    setZoomed(false)
    onIndexChange?.((index + delta + total) % total)
  }

  const zoomIn = (point?: { clientX: number; clientY: number }) => {
    const img = fitRef.current
    if (!img) return
    const rect = img.getBoundingClientRect()
    if (rect.width === 0) return
    const x = point?.clientX ?? rect.left + rect.width / 2
    const y = point?.clientY ?? rect.top + rect.height / 2
    const width = Math.round(Math.max(img.naturalWidth || 0, rect.width * 2))
    anchor.current = {
      fx: (x - rect.left) / rect.width,
      fy: (y - rect.top) / rect.height,
      x,
      y,
      h: (width * rect.height) / rect.width,
    }
    setZoomWidth(width)
    setZoomed(true)
  }

  // 放大後把點下去那一點捲回手指／游標底下，看起來像從那裡展開
  React.useLayoutEffect(() => {
    const scroller = scrollerRef.current
    const a = anchor.current
    if (!zoomed || !scroller || !a) return
    anchor.current = null
    const box = scroller.getBoundingClientRect()
    scroller.scrollLeft = a.fx * zoomWidth - (a.x - box.left)
    scroller.scrollTop = a.fy * a.h - (a.y - box.top)
  }, [zoomed, zoomWidth])

  if (!current) return null

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-70 bg-cream-50/95 backdrop-blur-sm" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-80 outline-none"
          onKeyDown={(e) => {
            if (zoomed) return
            if (e.key === 'ArrowLeft') step(-1)
            if (e.key === 'ArrowRight') step(1)
          }}
        >
          <Dialog.Title className="sr-only">{current.alt || t('imageViewer')}</Dialog.Title>

          <div
            ref={scrollerRef}
            // 點圖以外的空白處就關閉（放大時整個畫面都是圖，不會誤關）
            onClick={(e) => e.target === e.currentTarget && close()}
            onTouchStart={(e) => {
              const touch = e.touches[0]
              touchStart.current =
                !zoomed && e.touches.length === 1 && touch
                  ? { x: touch.clientX, y: touch.clientY }
                  : null
            }}
            onTouchEnd={(e) => {
              // 單指橫向滑過 50px 才換張；雙指縮放中或頁面已被放大時不算
              const start = touchStart.current
              const touch = e.changedTouches[0]
              touchStart.current = null
              if (!start || !touch || (window.visualViewport?.scale ?? 1) > 1) return
              const dx = touch.clientX - start.x
              if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(touch.clientY - start.y)) {
                step(dx < 0 ? 1 : -1)
              }
            }}
            className={cn(
              'no-scrollbar size-full overscroll-contain',
              zoomed ? 'overflow-auto' : 'flex items-center justify-center p-4 sm:p-16',
            )}
          >
            {zoomed ? (
              // 圖比畫面小的那一邊置中，比畫面大的那一邊從頭開始捲
              <div className="flex min-h-full w-max min-w-full items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element -- 要載原檔，見檔頭 */}
                <img
                  src={current.src}
                  alt={current.alt}
                  draggable={false}
                  onClick={() => setZoomed(false)}
                  style={{ width: zoomWidth }}
                  className="h-auto max-w-none cursor-zoom-out select-none"
                />
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- 要載原檔，見檔頭
              <img
                key={current.src}
                ref={fitRef}
                src={current.src}
                alt={current.alt}
                draggable={false}
                onClick={(e) => zoomIn(e)}
                className="h-auto max-h-[calc(100dvh-7rem)] w-auto max-w-full cursor-zoom-in select-none"
              />
            )}
          </div>

          <div className="absolute top-3 right-3 flex gap-2 sm:top-5 sm:right-5">
            <ToolButton
              label={zoomed ? t('zoomOut') : t('zoomIn')}
              onClick={() => (zoomed ? setZoomed(false) : zoomIn())}
            >
              {zoomed ? <ZoomOut size={18} /> : <ZoomIn size={18} />}
            </ToolButton>
            <Dialog.Close asChild>
              <ToolButton label={t('close')}>
                <X size={18} />
              </ToolButton>
            </Dialog.Close>
          </div>

          {multiple && (
            <>
              <ToolButton
                label={t('prevImage')}
                onClick={() => step(-1)}
                className="absolute top-1/2 left-2 -translate-y-1/2 sm:left-5"
              >
                <ChevronLeft size={20} />
              </ToolButton>
              <ToolButton
                label={t('nextImage')}
                onClick={() => step(1)}
                className="absolute top-1/2 right-2 -translate-y-1/2 sm:right-5"
              >
                <ChevronRight size={20} />
              </ToolButton>
              <p
                aria-live="polite"
                className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-cream-50/90 px-3 py-1 text-xs tabular-nums text-ink-700 shadow-sm ring-1 ring-ink-900/10"
              >
                {index + 1} / {total}
              </p>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function ToolButton({
  label,
  className,
  ...props
}: React.ComponentProps<'button'> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        'flex size-11 items-center justify-center rounded-full bg-cream-50/90 text-ink-900 shadow-sm ring-1 ring-ink-900/10 transition-colors hover:bg-ink-900 hover:text-cream-50',
        className,
      )}
      {...props}
    />
  )
}

/** 縮圖右下角的放大鏡：有滑鼠時移入才出現，觸控裝置沒有 hover 就常駐 */
export function ZoomBadge({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'pointer-events-none absolute right-2 bottom-2 flex size-7 items-center justify-center rounded-full bg-cream-50/85 text-ink-700 shadow-sm backdrop-blur-sm transition-opacity duration-300',
        'opacity-0 group-hover/zoom:opacity-100 group-focus-visible/zoom:opacity-100 pointer-coarse:opacity-90',
        className,
      )}
    >
      <ZoomIn size={14} />
    </span>
  )
}
