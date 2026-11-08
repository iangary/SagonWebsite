'use client'

import * as React from 'react'
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react'
import { cn } from '@/lib/utils'

const AUTOPLAY_MS = 6500
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

function subscribeReducedMotion(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_MOTION)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

/**
 * 首頁 Hero 輪播。
 *
 * 換張：原生 scroll-snap。手機的手指滑動、慣性與回彈都交給瀏覽器，不必自己寫手勢。
 * 所有張並排在同一列，flex 讓每張自動撐到最高那張的高度，換張時版面不會跳。
 *
 * 指示器是分段進度條（像限時動態）：目前那段會在 AUTOPLAY_MS 內填滿，
 * 填滿（onAnimationEnd）就換下一張。計時直接交給 CSS 動畫而不是 setTimeout，
 * 暫停時只要把 animation-play-state 設成 paused，放開後從原處接著跑，
 * 進度條與實際換張的時間永遠一致。
 *
 * 暫停時機：滑鼠移入、手指按住、鍵盤焦點在裡面、分頁切走或捲出畫面。
 * 使用者自己滑過或點過之後就不再自動換張（搶走正在看的那張比不會自己動更惱人），
 * 進度條改為整段填滿表示「停在這張」。prefers-reduced-motion 時一律不自動播。
 *
 * 箭頭只在有滑鼠的大螢幕出現（md 以上且非 pointer-coarse），浮在左右兩側、
 * 滑鼠移入輪播才顯形；手機與平板用手指滑，底部只留進度條與暫停鍵（WCAG 2.2.2）。
 *
 * 沒有用 inert 把其他張藏起來：h1 在第二張，藏起來輔助技術就讀不到；
 * 焦點移到畫面外那張的連結時，瀏覽器會自己把它捲進來，指示器也會跟著更新。
 */
export function HeroCarousel({
  slides,
  labels,
}: {
  slides: React.ReactNode[]
  labels: {
    region: string
    /** 每張的無障礙名稱（「第 1 張，共 4 張」），在 Server 端組好再傳進來 */
    slides: string[]
    prev: string
    next: string
    goTo: string[]
    pause: string
    play: string
  }
}) {
  const scrollerRef = React.useRef<HTMLDivElement>(null)
  const rootRef = React.useRef<HTMLElement>(null)
  const touchStart = React.useRef<{ x: number; y: number } | null>(null)
  const total = slides.length

  const [active, setActive] = React.useState(0)
  const [stopped, setStopped] = React.useState(false) // 按了暫停，或已經自己操作過
  const [hold, setHold] = React.useState(false) // 滑鼠移入／手指按住／焦點在裡面
  const [visible, setVisible] = React.useState(true) // 分頁在前景且 Hero 在畫面內
  const reducedMotion = React.useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  )

  // 依捲動位置算目前是第幾張（手指滑、鍵盤焦點、程式捲動都走這裡）
  React.useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (el.clientWidth === 0) return
        setActive(Math.min(total - 1, Math.max(0, Math.round(el.scrollLeft / el.clientWidth))))
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      el.removeEventListener('scroll', onScroll)
    }
  }, [total])

  React.useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let pageVisible = !document.hidden
    let inView = true
    const update = () => setVisible(pageVisible && inView)
    const onVisibility = () => {
      pageVisible = !document.hidden
      update()
    }
    document.addEventListener('visibilitychange', onVisibility)
    const io = new IntersectionObserver(
      (entries) => {
        inView = entries[0]?.isIntersecting ?? true
        update()
      },
      { threshold: 0.4 },
    )
    io.observe(root)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      io.disconnect()
    }
  }, [])

  const goTo = React.useCallback(
    (index: number) => {
      const el = scrollerRef.current
      if (!el) return
      const target = (index + total) % total
      el.scrollTo({ left: target * el.clientWidth, behavior: reducedMotion ? 'auto' : 'smooth' })
    },
    [total, reducedMotion],
  )

  const autoplay = total > 1 && !reducedMotion && !stopped
  const running = autoplay && !hold && visible

  // 使用者親手操作過就停掉自動播放
  const takeOver = () => setStopped(true)

  return (
    <section
      ref={rootRef}
      aria-roledescription="carousel"
      aria-label={labels.region}
      className="group/carousel relative"
      onMouseEnter={() => setHold(true)}
      onMouseLeave={() => setHold(false)}
      onFocus={() => setHold(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHold(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          // 在表單欄位裡按方向鍵是移動游標，不換張
          if ((e.target as HTMLElement).closest('input, textarea, select')) return
          e.preventDefault()
          takeOver()
          goTo(active + (e.key === 'ArrowRight' ? 1 : -1))
        }
      }}
    >
      <div
        ref={scrollerRef}
        // 手指按住就暫停進度條；真的滑動了才算接手、不再自動播放
        onPointerDown={(e) => {
          if (e.pointerType !== 'mouse') setHold(true)
        }}
        onPointerUp={(e) => {
          if (e.pointerType !== 'mouse') setHold(false)
        }}
        onPointerCancel={() => setHold(false)}
        onTouchStart={(e) => {
          const t = e.touches[0]
          touchStart.current = t ? { x: t.clientX, y: t.clientY } : null
        }}
        onTouchMove={(e) => {
          // 只有橫向滑動才算接手；上下捲動頁面時剛好按在輪播上不算
          const start = touchStart.current
          const t = e.touches[0]
          if (!start || !t) return
          const dx = Math.abs(t.clientX - start.x)
          if (dx > 10 && dx > Math.abs(t.clientY - start.y)) {
            touchStart.current = null
            takeOver()
          }
        }}
        onWheel={(e) => {
          if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) takeOver()
        }}
        className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
      >
        {slides.map((slide, i) => (
          <div
            key={i}
            role="group"
            aria-roledescription="slide"
            aria-label={labels.slides[i]}
            className="flex w-full shrink-0 snap-start snap-always flex-col [&>*]:flex-1"
          >
            {slide}
          </div>
        ))}
      </div>

      {total > 1 && (
        <>
          {/* 左右箭頭：只給有滑鼠的大螢幕，滑鼠移入輪播或鍵盤聚焦時才顯形 */}
          <EdgeArrow
            side="left"
            label={labels.prev}
            onClick={() => {
              takeOver()
              goTo(active - 1)
            }}
          />
          <EdgeArrow
            side="right"
            label={labels.next}
            onClick={() => {
              takeOver()
              goTo(active + 1)
            }}
          />

          {/* 底部：分段進度條 + 暫停鍵 */}
          <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-6">
            <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-cream-50/75 py-1 pr-1 pl-3 shadow-sm backdrop-blur-sm">
              <div className="flex items-center gap-1.5">
                {slides.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={labels.goTo[i]}
                    aria-current={i === active ? 'true' : undefined}
                    onClick={() => {
                      takeOver()
                      goTo(i)
                    }}
                    // 外框是點擊範圍（高 32px），裡面 2px 高的細條才是看得到的進度條
                    className="group/seg flex h-8 items-center rounded-sm focus-visible:outline-offset-0"
                  >
                    <span
                      className={cn(
                        'relative block h-0.5 overflow-hidden rounded-full bg-ink-900/20 transition-[width,background-color] duration-300 group-hover/seg:bg-ink-900/35',
                        i === active ? 'w-10 sm:w-12' : 'w-5 sm:w-6',
                      )}
                    >
                      {i === active && (
                        <span
                          // 換張或切換播放狀態時重掛，動畫從 0 重新跑
                          key={`${active}-${autoplay}`}
                          aria-hidden
                          className="absolute inset-0 origin-left bg-plum-600"
                          style={
                            autoplay
                              ? {
                                  animation: `hero-progress ${AUTOPLAY_MS}ms linear forwards`,
                                  animationPlayState: running ? 'running' : 'paused',
                                }
                              : undefined
                          }
                          onAnimationEnd={() => goTo(active + 1)}
                        />
                      )}
                    </span>
                  </button>
                ))}
              </div>

              {!reducedMotion && (
                <button
                  type="button"
                  aria-label={stopped ? labels.play : labels.pause}
                  onClick={() => setStopped((s) => !s)}
                  className="ml-1 flex size-8 items-center justify-center rounded-full text-ink-700 transition-colors hover:bg-ink-900 hover:text-cream-50 focus-visible:outline-offset-0"
                >
                  {stopped ? <Play size={13} /> : <Pause size={13} />}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  )
}

function EdgeArrow({
  side,
  label,
  onClick,
}: {
  side: 'left' | 'right'
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        'absolute top-1/2 hidden size-12 -translate-y-1/2 items-center justify-center rounded-full bg-cream-50/80 text-ink-900 shadow-sm backdrop-blur-sm transition-[opacity,background-color,color] duration-300 hover:bg-ink-900 hover:text-cream-50 md:flex pointer-coarse:hidden',
        'opacity-0 group-hover/carousel:opacity-100 focus-visible:opacity-100',
        side === 'left' ? 'left-4 lg:left-6' : 'right-4 lg:right-6',
      )}
    >
      {side === 'left' ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
    </button>
  )
}
