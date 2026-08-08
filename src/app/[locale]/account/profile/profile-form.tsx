'use client'

import * as React from 'react'
import { useActionState } from 'react'
import { useSession } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Input, Field } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { updateProfile, type ActionState } from '../actions'

const INITIAL: ActionState = { ok: false }

export function ProfileForm({ defaultName }: { defaultName: string }) {
  const { toast } = useToast()
  const { update } = useSession()
  const [state, formAction, pending] = useActionState(updateProfile, INITIAL)
  const [name, setName] = React.useState(defaultName)

  React.useEffect(() => {
    if (state.ok && state.message) {
      toast(state.message)
      // 同步 JWT 裡的名字，header 的會員選單才會立刻跟著變
      void update({ name })
    }
    if (state.error) toast(state.error, 'error')
  }, [state, toast, update, name])

  return (
    <form action={formAction} className="border border-cream-200 bg-white p-6">
      <h2 className="text-sm tracking-[0.1em]">個人資料</h2>

      <div className="mt-5 max-w-sm">
        <Field label="姓名" htmlFor="name" required error={state.fieldErrors?.name}>
          <Input
            id="name"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            required
          />
        </Field>
      </div>

      <div className="mt-6">
        <Button type="submit" disabled={pending}>
          {pending ? '儲存中…' : '儲存'}
        </Button>
      </div>
    </form>
  )
}
