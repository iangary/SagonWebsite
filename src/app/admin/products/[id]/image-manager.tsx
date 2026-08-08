'use client'

import * as React from 'react'
import { useActionState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { Upload, Trash2, ChevronLeft, ChevronRight, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import {
  uploadProductImages,
  deleteProductImage,
  reorderProductImages,
  type UploadState,
} from '../actions'

type ProductImage = {
  id: string
  url: string
  width: number | null
  height: number | null
}

const INITIAL: UploadState = { ok: false }

export function ImageManager({
  productId,
  images,
  maxFiles,
  maxBytes,
}: {
  productId: string
  images: ProductImage[]
  maxFiles: number
  maxBytes: number
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [state, formAction, uploading] = useActionState(uploadProductImages, INITIAL)
  const fileRef = React.useRef<HTMLInputElement>(null)
  const formRef = React.useRef<HTMLFormElement>(null)
  const [busy, setBusy] = React.useState(false)

  // 排序用本地狀態，讓左右移動立即有反應，再送到伺服器
  const [order, setOrder] = React.useState(images)
  React.useEffect(() => setOrder(images), [images])

  React.useEffect(() => {
    if (state.ok) {
      toast(state.message ?? '已上傳')
      formRef.current?.reset()
      router.refresh()
    }
    if (state.error) toast(state.error, 'error')
    // 個別失敗的檔案逐一告知，營運才知道要重傳哪幾張
    for (const failure of state.failures ?? []) {
      toast(`${failure.filename}：${failure.reason}`, 'error')
    }
  }, [state, toast, router])

  async function remove(imageId: string) {
    if (!window.confirm('確定要刪除這張圖片嗎？檔案會一併從磁碟移除。')) return
    setBusy(true)
    const result = await deleteProductImage(imageId)
    setBusy(false)
    if (!result.ok) {
      toast(result.error ?? '刪除失敗', 'error')
      return
    }
    toast('圖片已刪除')
    router.refresh()
  }

  async function move(index: number, direction: -1 | 1) {
    const next = index + direction
    if (next < 0 || next >= order.length) return

    const reordered = [...order]
    const [moved] = reordered.splice(index, 1)
    reordered.splice(next, 0, moved!)
    setOrder(reordered)

    setBusy(true)
    const result = await reorderProductImages(
      productId,
      reordered.map((i) => i.id),
    )
    setBusy(false)

    if (!result.ok) {
      toast(result.error ?? '排序失敗', 'error')
      setOrder(images) // 失敗就還原
      return
    }
    router.refresh()
  }

  const maxMb = (maxBytes / 1024 / 1024).toFixed(0)

  return (
    <section className="border border-cream-200 bg-white p-5">
      <h2 className="mb-2 text-sm tracking-[0.1em]">商品圖片（{order.length}）</h2>
      <p className="mb-5 text-xs text-taupe-500">
        第一張是主圖，會用在商品列表與社群分享預覽。上傳後會自動轉成 WebP
        並把最長邊縮到 1600px，手機直拍的大圖不用先處理。
        單張上限 {maxMb} MB，一次最多 {maxFiles} 張。
      </p>

      {order.length > 0 && (
        <ul className="mb-6 flex flex-wrap gap-3">
          {order.map((image, index) => (
            <li key={image.id} className="w-32">
              <div className="relative aspect-[3/4] overflow-hidden bg-cream-100">
                <Image
                  src={image.url}
                  alt=""
                  fill
                  sizes="128px"
                  className="object-cover"
                />
                {index === 0 && (
                  <Badge tone="dark" className="absolute left-1.5 top-1.5 gap-1">
                    <Star size={9} className="fill-current" />
                    主圖
                  </Badge>
                )}
              </div>

              <div className="mt-1.5 flex items-center justify-between">
                <div className="flex gap-0.5">
                  <IconButton
                    label="往前移"
                    disabled={index === 0 || busy}
                    onClick={() => move(index, -1)}
                  >
                    <ChevronLeft size={14} />
                  </IconButton>
                  <IconButton
                    label="往後移"
                    disabled={index === order.length - 1 || busy}
                    onClick={() => move(index, 1)}
                  >
                    <ChevronRight size={14} />
                  </IconButton>
                </div>
                <IconButton label="刪除" disabled={busy} onClick={() => remove(image.id)} danger>
                  <Trash2 size={13} />
                </IconButton>
              </div>

              {image.width && image.height && (
                <p className="mt-0.5 text-center text-[10px] tabular-nums text-taupe-400">
                  {image.width}×{image.height}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <form ref={formRef} action={formAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="productId" value={productId} />
        <div>
          <label
            htmlFor="images"
            className="mb-1.5 block text-xs font-medium tracking-wide text-ink-700"
          >
            選擇圖片
          </label>
          <input
            ref={fileRef}
            id="images"
            name="images"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            multiple
            required
            className="border border-cream-300 bg-white px-3 py-2 text-sm file:mr-3 file:border-0 file:bg-cream-100 file:px-3 file:py-1 file:text-xs file:text-ink-700"
          />
        </div>
        <Button type="submit" disabled={uploading}>
          <Upload size={15} />
          {uploading ? '上傳中…' : '上傳'}
        </Button>
      </form>
    </section>
  )
}

function IconButton({
  label,
  disabled,
  danger,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  danger?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex size-6 items-center justify-center transition-colors disabled:cursor-not-allowed disabled:text-taupe-300 ${
        danger ? 'text-taupe-500 hover:text-sale' : 'text-ink-700 hover:bg-cream-100'
      }`}
    >
      {children}
    </button>
  )
}
