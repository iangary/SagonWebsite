import { ImageResponse } from 'next/og'

/*
 * iOS「加入主畫面」用的圖示。尺寸固定 180×180（Apple 的規格）。
 * 設計與 icon.tsx 一致，理由見該檔。
 */

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#2b2724', // --color-ink-900
          color: '#faf8f5', // --color-cream-50
          fontSize: 104,
          fontWeight: 600,
          letterSpacing: '0.02em',
        }}
      >
        S
      </div>
    ),
    size,
  )
}
