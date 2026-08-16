import { Fragment } from 'react'

/*
 * 品牌名跑馬燈。純 CSS 動畫的 Server Component：
 * 內容鋪到夠寬後整份複製一次，track 平移 -50% 即無縫循環。
 * 減少動態偏好由 globals.css 的全域開關處理（動畫時長被壓成 0.01ms，等同靜止）。
 */
export function BrandMarquee({ items }: { items: string[] }) {
  if (items.length === 0) return null

  // 至少鋪 10 個項目，太短的清單循環時會露出空白
  const base: string[] = []
  while (base.length < 10) base.push(...items)

  const row = (key: string) => (
    <Fragment key={key}>
      {base.map((name, i) => (
        <span
          key={`${key}-${i}`}
          className="px-8 font-serif-display text-[13px] tracking-[0.3em] whitespace-nowrap text-taupe-600"
        >
          {name}
          <span aria-hidden className="ml-16 text-cream-300">
            ·
          </span>
        </span>
      ))}
    </Fragment>
  )

  return (
    <div
      aria-hidden
      className="overflow-hidden border-y border-cream-200 bg-cream-50"
    >
      <div className="flex w-max animate-[marquee_36s_linear_infinite] py-3.5 hover:[animation-play-state:paused]">
        {row('a')}
        {row('b')}
      </div>
    </div>
  )
}
