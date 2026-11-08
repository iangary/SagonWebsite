'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ImageLightbox, type LightboxImage } from '@/components/ui/image-lightbox'

/**
 * 收摺高度的上限。參考站 Marais 的 `.intro.collapsed` 是 550px，這裡取 34rem（544px）。
 * 要超過這個高度再加一段緩衝才值得出現按鈕 —— 只差幾十像素就收摺，
 * 按鈕點下去畫面幾乎沒變化，反而像壞掉。
 */
export const COLLAPSED_MAX_PX = 544
export const WORTH_COLLAPSING_PX = COLLAPSED_MAX_PX + 80

export function ProductDescription({
  html,
  labels,
}: {
  html: string
  labels: { expand: string; collapse: string }
}) {
  const regionId = useId()
  const contentRef = useRef<HTMLDivElement>(null)
  const userToggled = useRef(false)
  const [collapsible, setCollapsible] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const [zoom, setZoom] = useState<{ images: LightboxImage[]; index: number } | null>(null)

  /*
   * 預設展開、掛載後才收摺 —— 沿用 globals.css 註解裡那套「JS 閘門」的理由：
   * 無 JS、爬蟲與 hydration 前一律看得到完整內容。商品描述是這頁最主要的
   * SEO 文字，SSR 就藏起來會直接影響搜尋結果。
   */
  useEffect(() => {
    const el = contentRef.current
    if (!el) return

    const measure = () => {
      const tall = el.scrollHeight > WORTH_COLLAPSING_PX
      setCollapsible(tall)
      // 使用者按過之後就不再自動收回去，否則圖片繼續載入會把展開狀態彈掉
      if (tall && !userToggled.current) setExpanded(false)
    }

    measure()
    // 描述裡有數十張 lazy-load 圖片，高度是邊載邊長的，量一次不夠
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const collapsed = collapsible && !expanded

  return (
    <>
      <div
        id={regionId}
        className={cn('relative', collapsed && 'max-h-[34rem] overflow-hidden')}
      >
        <div
          ref={contentRef}
          // 描述是後端過濾過的 HTML，沒辦法逐張包成按鈕，改在外層接點擊：
          // 點到哪張就從那張開檢視器，左右可以翻完整段描述的所有圖。包在連結裡的圖照常跳連結。
          onClick={(e) => {
            const target = e.target as HTMLElement
            if (target.tagName !== 'IMG' || target.closest('a')) return
            const imgs = [...e.currentTarget.querySelectorAll('img')].filter((img) => !img.closest('a'))
            setZoom({
              images: imgs.map((img) => ({ src: img.currentSrc || img.src, alt: img.alt })),
              index: imgs.indexOf(target as HTMLImageElement),
            })
          }}
          className="prose-product [&_img:not(a_img)]:cursor-zoom-in"
          // 已經過 normalizeDescriptionHtml 的允許清單過濾（見 src/lib/catalog/description.ts）
          dangerouslySetInnerHTML={{ __html: html }}
        />
        {collapsed && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-cream-50 to-transparent"
          />
        )}
      </div>

      {zoom && (
        <ImageLightbox
          images={zoom.images}
          index={zoom.index}
          onIndexChange={(index) => setZoom((z) => z && { ...z, index })}
          open
          onOpenChange={(open) => !open && setZoom(null)}
        />
      )}

      {collapsible && (
        <Button
          type="button"
          variant="outline"
          full
          className="mt-8"
          aria-expanded={expanded}
          aria-controls={regionId}
          onClick={() => {
            userToggled.current = true
            setExpanded((v) => !v)
          }}
        >
          {expanded ? labels.collapse : labels.expand}
          <ChevronDown
            aria-hidden
            className={cn('transition-transform duration-300', expanded && 'rotate-180')}
          />
        </Button>
      )}
    </>
  )
}
