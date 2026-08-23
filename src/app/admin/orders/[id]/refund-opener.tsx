'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { adminCreateRefund } from '@/app/admin/refunds/actions'

/**
 * 客服在訂單頁開退款單。
 *
 * 客人是在 LINE 上談退款的（前台沒有申請表單），所以原因與收款帳戶都由客服代填。
 * 信用卡付款不需要帳戶（可以線上退刷），其他付款方式綠界沒有退款 API，
 * 只能人工匯款 —— 帳戶欄位會在那些訂單上顯示為必要資訊。
 */
export function RefundOpener({
  orderId,
  needsBankAccount,
  windowClosed,
}: {
  orderId: string
  needsBankAccount: boolean
  /** 已超過退款期限：要開單就得明確勾選 */
  windowClosed: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [open, setOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [override, setOverride] = React.useState(false)

  async function submit(formData: FormData) {
    setPending(true)
    const result = await adminCreateRefund({
      orderId,
      reason: String(formData.get('reason') ?? ''),
      bankCode: String(formData.get('bankCode') ?? ''),
      bankAccountNo: String(formData.get('bankAccountNo') ?? ''),
      accountName: String(formData.get('accountName') ?? ''),
      overrideWindow: override,
    })
    setPending(false)

    if (!result.ok) {
      toast(result.error, 'error')
      return
    }
    toast(result.message)
    setOpen(false)
    router.refresh()
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Undo2 size={14} />
        建立退款單
      </Button>
    )
  }

  return (
    <form action={submit} className="space-y-3">
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium tracking-wide text-ink-700">
          退款原因
        </span>
        <Textarea
          name="reason"
          rows={3}
          maxLength={500}
          placeholder="例如：客人反映袖口脫線，LINE 已確認照片，同意退貨退款"
          required
        />
      </label>

      {needsBankAccount && (
        <>
          <p className="text-xs leading-relaxed text-sale">
            這筆不是信用卡付款，綠界沒有退款 API，只能人工匯款。帳戶可以現在填，
            也可以等客人在 LINE 上給了再回來補。
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input name="bankCode" placeholder="銀行代碼 812" inputMode="numeric" maxLength={7} />
            <Input name="accountName" placeholder="戶名" maxLength={50} />
            <div className="sm:col-span-2">
              <Input
                name="bankAccountNo"
                placeholder="銀行帳號（只填數字）"
                inputMode="numeric"
                maxLength={30}
              />
            </div>
          </div>
        </>
      )}

      {windowClosed && (
        <label className="flex cursor-pointer items-start gap-2 text-xs text-sale">
          <input
            type="checkbox"
            checked={override}
            onChange={(e) => setOverride(e.target.checked)}
            className="mt-0.5 size-4 accent-[#2b2724]"
          />
          已超過退款期限，仍要建立（個案處理，會記在稽核紀錄裡）
        </label>
      )}

      <div className="flex gap-2">
        <Button size="sm" type="submit" disabled={pending}>
          {pending ? '建立中…' : '建立'}
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)}>
          取消
        </Button>
      </div>
    </form>
  )
}
