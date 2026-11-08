'use client'

import * as React from 'react'
import Image, { type StaticImageData } from 'next/image'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { ImageLightbox, ZoomBadge } from '@/components/ui/image-lightbox'

/**
 * 點了可以放大看的單張圖（首頁輪播用）。縮圖照常走 next/image，
 * 點下去開 ImageLightbox 看原檔。
 */
export function ZoomableImage({
  src,
  alt,
  sizes,
  priority,
  loading,
  className,
  triggerClassName,
  badgeClassName,
}: {
  src: StaticImageData
  alt: string
  sizes?: string
  priority?: boolean
  loading?: 'eager' | 'lazy'
  /** 縮圖本身的 class（尺寸照舊寫在這裡） */
  className?: string
  /** 包住縮圖的按鈕；縮圖用百分比寬度時要在這裡給按鈕寬度 */
  triggerClassName?: string
  /** 右下角放大鏡的位置微調 */
  badgeClassName?: string
}) {
  const t = useTranslations('common')
  const [open, setOpen] = React.useState(false)
  const label = alt ? `${t('viewImage')}${t('colon')}${alt}` : t('viewImage')

  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={cn('group/zoom relative block max-w-full cursor-zoom-in', triggerClassName)}
      >
        <Image
          src={src}
          alt={alt}
          sizes={sizes}
          priority={priority}
          loading={loading}
          className={className}
        />
        <ZoomBadge className={badgeClassName} />
      </button>
      <ImageLightbox images={[{ src: src.src, alt }]} index={0} open={open} onOpenChange={setOpen} />
    </>
  )
}
