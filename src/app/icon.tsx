import { ImageResponse } from 'next/og'

/*
 * 瀏覽器分頁與書籤的圖示。放在 app 根目錄，中英文站共用。
 *
 * 刻意用英文字母而不是「莎」—— ImageResponse 要另外餵中文字體 buffer
 * 才畫得出漢字（見 lib/seo/og-font.ts），為了一個 32px 的圖示連外抓字體
 * 不划算，而且 favicon 這種尺寸下漢字本來就糊成一團。
 */

export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
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
          fontSize: 20,
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
