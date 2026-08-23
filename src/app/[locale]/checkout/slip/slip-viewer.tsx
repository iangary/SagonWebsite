'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { Printer, ImageDown, Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * 繳費單顯示與存檔。
 *
 * 繳費單本身是伺服器產生的 SVG 字串（見 lib/barcode/payment-slip.ts），
 * 這裡只做三件事：顯示成圖片、下載 PNG、列印。
 *
 * 為什麼是「圖片」而不是網頁排版：消費者到超商時常常沒網路，也可能已經把
 * 分頁關掉。存成一張圖之後，手機長按就能收進相簿，離線也看得到、印得出來。
 */
export function SlipViewer({
  svg,
  orderNo,
  paymentNo,
}: {
  svg: string
  orderNo: string
  paymentNo: string | null
}) {
  const t = useTranslations('slip')
  const [copied, setCopied] = React.useState(false)
  const [downloading, setDownloading] = React.useState(false)

  // SVG 轉 data URL。用 encodeURIComponent 而不是 btoa —— 內容有中文，
  // btoa 遇到非 Latin-1 字元會直接丟 InvalidCharacterError。
  const dataUrl = React.useMemo(
    () => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    [svg],
  )

  async function copyCode() {
    if (!paymentNo) return
    try {
      await navigator.clipboard.writeText(paymentNo)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // 沒有剪貼簿權限就算了，畫面上的號碼可以手動選取
    }
  }

  /**
   * 下載 PNG。
   * 走 canvas 而不是直接下載 SVG —— iOS 的相簿不收 SVG，PNG 才存得進去。
   */
  async function downloadPng() {
    setDownloading(true)
    try {
      const image = new Image()
      image.src = dataUrl
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('繳費單圖片載入失敗'))
      })

      // 放大兩倍再輸出，手機螢幕與印表機才不會看到鋸齒
      const scale = 2
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth * scale
      canvas.height = image.naturalHeight * scale
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('瀏覽器不支援 canvas')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)

      const link = document.createElement('a')
      link.href = canvas.toDataURL('image/png')
      link.download = `payment-${orderNo}.png`
      link.click()
    } catch (error) {
      console.error(error)
      // 轉檔失敗時退回開新視窗，使用者仍能長按存圖
      window.open(dataUrl, '_blank')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div>
      {/* eslint-disable-next-line @next/next/no-img-element -- data: URL 的 SVG，next/image 無法最佳化 */}
      <img
        src={dataUrl}
        alt={t('imageAlt')}
        className="w-full border border-cream-300 bg-white"
      />

      <p className="mt-3 text-xs leading-relaxed text-taupe-500">{t('saveHint')}</p>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row print:hidden">
        <Button type="button" onClick={downloadPng} disabled={downloading}>
          <ImageDown size={16} />
          {downloading ? t('saving') : t('saveImage')}
        </Button>
        <Button type="button" variant="outline" onClick={() => window.print()}>
          <Printer size={16} />
          {t('print')}
        </Button>
        {paymentNo && (
          <Button type="button" variant="outline" onClick={copyCode}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? t('copied') : t('copyCode')}
          </Button>
        )}
      </div>
    </div>
  )
}
