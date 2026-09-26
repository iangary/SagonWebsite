import { ImageResponse } from 'next/og'
import { getTranslations } from 'next-intl/server'
import { shopConfig, shopName } from '@/lib/shop-config'
import { loadNotoSansTcSubset } from '@/lib/seo/og-font'

/*
 * 全站預設的分享圖。貼到 LINE、Facebook、Threads 時出現的那張。
 *
 * 商品頁有自己的 openGraph.images（用商品照），會蓋過這張；
 * 其餘所有頁面 —— 首頁、分類、關於、FAQ —— 都吃這裡。
 */

export const alt = `${shopConfig.name} — ${shopConfig.nameEn}`
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// 品牌色，對齊 src/styles/globals.css 的 --color-*
const CREAM_50 = '#faf8f5'
const CREAM_200 = '#e9e2d8'
const INK_900 = '#2b2724'
const TAUPE_600 = '#857263'
const ROSE_ACCENT = '#c98b7f'

export default async function OpenGraphImage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'home' })

  const name = shopName(locale)
  const tagline = t('heroSubtitle')
  /*
   * 先在這裡轉成大寫，不要交給 CSS 的 textTransform。
   *
   * satori 會先套 uppercase 再找字形，但字體子集是照下面那串字要來的 ——
   * 只要了小寫的 'agan'，大寫 'AGAN' 不在子集裡就會退回預設字體，
   * 結果是「S」跟「AGAN」大小不一樣的破字。
   */
  const wordmark = shopConfig.nameEn.toUpperCase()

  /*
   * 中文字體載入失敗時退回英文店名，而不是讓中文變成一排方框。
   * 只有需要中文字形時才連外（英文語系的字全在預設字體裡）。
   */
  const needsCjk = /[㐀-鿿]/.test(name + tagline)
  const fontData = needsCjk ? await loadNotoSansTcSubset(name + tagline + wordmark) : null

  const useCjk = !needsCjk || fontData !== null
  const displayName = useCjk ? name : shopConfig.nameEn
  const displayTagline = useCjk ? tagline : 'Curated Korean sleepwear, bedding and home goods'

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: CREAM_50,
          // 細邊框讓圖在白底的聊天視窗裡不會糊成一片
          border: `16px solid ${CREAM_200}`,
        }}
      >
        <div
          style={{
            width: 64,
            height: 2,
            background: ROSE_ACCENT,
            marginBottom: 48,
          }}
        />
        <div
          style={{
            fontSize: 96,
            fontWeight: 600,
            color: INK_900,
            letterSpacing: '0.08em',
            display: 'flex',
          }}
        >
          {displayName}
        </div>
        <div
          style={{
            fontSize: 36,
            color: TAUPE_600,
            marginTop: 28,
            letterSpacing: '0.14em',
            display: 'flex',
          }}
        >
          {displayTagline}
        </div>
        <div
          style={{
            fontSize: 24,
            color: TAUPE_600,
            marginTop: 72,
            letterSpacing: '0.22em',
            display: 'flex',
          }}
        >
          {wordmark}
        </div>
      </div>
    ),
    {
      ...size,
      ...(fontData
        ? { fonts: [{ name: 'Noto Sans TC', data: fontData, style: 'normal', weight: 600 }] }
        : {}),
    },
  )
}
