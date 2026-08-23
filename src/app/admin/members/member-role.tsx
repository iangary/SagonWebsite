'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck, ShieldMinus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { setMemberRole } from './actions'

/**
 * 會員列表上的「設為管理員／移除管理員」。
 *
 * 升權是不可逆到「對方看得到全店訂單與客人資料」的一步，所以按下去先問一次，
 * 並且把權限範圍講明白 —— 營運多半不知道管理員能看到什麼。
 */
export function MemberRoleButton({
  userId,
  label,
  isAdmin,
  /** 不能動這一列的原因（自己、或最後一位管理員）；有值就只顯示說明不給按 */
  blockedReason,
}: {
  userId: string
  label: string
  isAdmin: boolean
  blockedReason?: string
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, setPending] = React.useState(false)

  if (blockedReason) {
    return <span className="text-xs text-taupe-500">{blockedReason}</span>
  }

  async function change() {
    const message = isAdmin
      ? `要移除「${label}」的管理員權限嗎？他會立刻進不了後台。`
      : `要把「${label}」設為管理員嗎？他將能看到所有訂單與會員資料，並且可以改商品、出貨與退款。`
    if (!window.confirm(message)) return

    setPending(true)
    const result = await setMemberRole({ userId, role: isAdmin ? 'CUSTOMER' : 'ADMIN' })
    setPending(false)

    if (!result.ok) {
      toast(result.error, 'error')
      return
    }
    toast(result.message)
    router.refresh()
  }

  return (
    <Button
      size="sm"
      variant={isAdmin ? 'ghost' : 'outline'}
      disabled={pending}
      onClick={change}
    >
      {isAdmin ? <ShieldMinus size={13} /> : <ShieldCheck size={13} />}
      {pending ? '處理中…' : isAdmin ? '移除管理員' : '設為管理員'}
    </Button>
  )
}
