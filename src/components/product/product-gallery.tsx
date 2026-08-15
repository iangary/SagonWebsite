'use client'

import * as React from 'react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

type GalleryImage = { url: string; alt: string | null }

export function ProductGallery({ images, name }: { images: GalleryImage[]; name: string }) {
  const t = useTranslations('product')
  const [index, setIndex] = React.useState(0)

  if (images.length === 0) {
    return (
      <div className="flex aspect-[3/4] items-center justify-center bg-cream-100 text-sm text-taupe-400">
        {t('noImage')}
      </div>
    )
  }

  const current = images[Math.min(index, images.length - 1)]!
  const step = (delta: number) =>
    setIndex((i) => (i + delta + images.length) % images.length)

  return (
    <div className="flex flex-col gap-3 lg:flex-row-reverse lg:gap-4">
      <div className="relative aspect-[3/4] flex-1 overflow-hidden bg-cream-100">
        <Image
          src={current.url}
          alt={current.alt ?? name}
          fill
          priority
          sizes="(min-width: 1024px) 45vw, 100vw"
          className="object-cover"
        />

        {images.length > 1 && (
          <>
            <GalleryArrow side="left" label={t('prevImage')} onClick={() => step(-1)} />
            <GalleryArrow side="right" label={t('nextImage')} onClick={() => step(1)} />
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-cream-50/85 px-2.5 py-1 text-[11px] tabular-nums text-ink-700">
              {index + 1} / {images.length}
            </div>
          </>
        )}
      </div>

      {images.length > 1 && (
        <ul className="no-scrollbar flex gap-2 overflow-x-auto lg:w-20 lg:flex-col lg:overflow-y-auto">
          {images.map((img, i) => (
            <li key={img.url} className="shrink-0">
              <button
                onClick={() => setIndex(i)}
                aria-label={t('viewImage', { index: i + 1 })}
                aria-current={i === index}
                className={cn(
                  'relative block size-16 overflow-hidden border transition-colors lg:size-20',
                  i === index ? 'border-ink-900' : 'border-transparent hover:border-cream-300',
                )}
              >
                <Image src={img.url} alt="" fill sizes="80px" className="object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function GalleryArrow({
  side,
  label,
  onClick,
}: {
  side: 'left' | 'right'
  label: string
  onClick: () => void
}) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={cn(
        'absolute top-1/2 flex size-9 -translate-y-1/2 items-center justify-center bg-cream-50/85 text-ink-700 transition-colors hover:bg-cream-50',
        side === 'left' ? 'left-2' : 'right-2',
      )}
    >
      <Icon size={18} />
    </button>
  )
}
