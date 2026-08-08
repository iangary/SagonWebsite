'use client'

import * as React from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select, Field } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { createCoupon, toggleCoupon, type CouponFormState } from './actions'

const INITIAL: CouponFormState = { ok: false }

export function CouponForm() {
  const { toast } = useToast()
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [state, formAction, pending] = useActionState(createCoupon, INITIAL)
  const [type, setType] = React.useState<'PERCENT' | 'FIXED' | 'FREE_SHIPPING'>('FIXED')
  const formRef = React.useRef<HTMLFormElement>(null)

  React.useEffect(() => {
    if (state.ok && state.message) {
      toast(state.message)
      formRef.current?.reset()
      setOpen(false)
      router.refresh()
    }
    if (state.error) toast(state.error, 'error')
  }, [state, toast, router])

  const errors = state.fieldErrors ?? {}

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus size={15} />
        新增折扣碼
      </Button>
    )
  }

  return (
    <form ref={formRef} action={formAction} className="border border-cream-200 bg-white p-5">
      <h2 className="mb-5 text-sm tracking-[0.1em]">新增折扣碼</h2>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="折扣碼" htmlFor="code" required error={errors.code} hint="英數、底線、連字號">
          <Input id="code" name="code" placeholder="SUMMER2026" required className="font-mono" />
        </Field>

        <Field label="說明" htmlFor="description">
          <Input id="description" name="description" placeholder="夏季全站優惠" maxLength={100} />
        </Field>

        <Field label="類型" htmlFor="type" required>
          <Select
            id="type"
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value as typeof type)}
          >
            <option value="FIXED">固定金額折抵</option>
            <option value="PERCENT">百分比折扣</option>
            <option value="FREE_SHIPPING">免運費</option>
          </Select>
        </Field>

        <Field
          label={type === 'PERCENT' ? '折扣百分比' : '折抵金額'}
          htmlFor="value"
          required={type !== 'FREE_SHIPPING'}
          error={errors.value}
          hint={type === 'PERCENT' ? '10 代表打九折' : type === 'FREE_SHIPPING' ? '免運不需填' : undefined}
        >
          <Input
            id="value"
            name="value"
            type="number"
            min={0}
            defaultValue={0}
            disabled={type === 'FREE_SHIPPING'}
          />
        </Field>

        <Field label="最低消費" htmlFor="minSubtotal" hint="0 代表不限">
          <Input id="minSubtotal" name="minSubtotal" type="number" min={0} defaultValue={0} />
        </Field>

        <Field label="每人可用次數" htmlFor="perUserLimit" required>
          <Input id="perUserLimit" name="perUserLimit" type="number" min={1} defaultValue={1} />
        </Field>

        <Field label="總使用上限" htmlFor="usageLimit" hint="留空代表不限">
          <Input id="usageLimit" name="usageLimit" type="number" min={1} />
        </Field>

        <Field label="開始日期" htmlFor="startsAt">
          <Input id="startsAt" name="startsAt" type="date" />
        </Field>

        <Field label="結束日期" htmlFor="endsAt" error={errors.endsAt}>
          <Input id="endsAt" name="endsAt" type="date" />
        </Field>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          取消
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? '建立中…' : '建立'}
        </Button>
      </div>
    </form>
  )
}

export function CouponToggle({ couponId, isActive }: { couponId: string; isActive: boolean }) {
  const router = useRouter()
  const { toast } = useToast()
  const [pending, setPending] = React.useState(false)

  async function toggle() {
    setPending(true)
    const result = await toggleCoupon(couponId, !isActive)
    setPending(false)
    if (!result.ok) {
      toast(result.error ?? '操作失敗', 'error')
      return
    }
    toast(isActive ? '已停用' : '已啟用')
    router.refresh()
  }

  return (
    <Button size="sm" variant="ghost" disabled={pending} onClick={toggle}>
      {isActive ? '停用' : '啟用'}
    </Button>
  )
}
