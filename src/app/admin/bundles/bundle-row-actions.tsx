'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { deleteBundle, moveBundle, toggleBundle, type BundleActionResult } from './actions'

export function BundleRowActions({
  bundleId,
  name,
  isActive,
  isFirst,
  isLast,
}: {
  bundleId: string
  name: string
  isActive: boolean
  isFirst: boolean
  isLast: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, setPending] = React.useState(false)

  async function run(action: () => Promise<BundleActionResult>) {
    setPending(true)
    const result = await action()
    setPending(false)
    if (!result.ok) {
      toast(result.error, 'error')
      return
    }
    if (result.message) toast(result.message)
    router.refresh()
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button
        size="sm"
        variant="ghost"
        disabled={pending || isFirst}
        aria-label={`把「${name}」往上移`}
        onClick={() => run(() => moveBundle(bundleId, 'up'))}
      >
        <ArrowUp size={14} />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending || isLast}
        aria-label={`把「${name}」往下移`}
        onClick={() => run(() => moveBundle(bundleId, 'down'))}
      >
        <ArrowDown size={14} />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => run(() => toggleBundle(bundleId, !isActive))}
      >
        {isActive ? '下架' : '上架'}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        className="text-sale"
        onClick={() => {
          if (!window.confirm(`確定刪除組合「${name}」？已成立的訂單不受影響。`)) return
          void run(() => deleteBundle(bundleId))
        }}
      >
        刪除
      </Button>
    </div>
  )
}
