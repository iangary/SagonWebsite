'use client'

import * as React from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Field } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { createPost, type PostFormState } from '../actions'

const INITIAL: PostFormState = { ok: false }

export function NewPostForm() {
  const router = useRouter()
  const { toast } = useToast()
  const [state, formAction, pending] = useActionState(createPost, INITIAL)

  React.useEffect(() => {
    if (state.ok && state.redirectTo) {
      toast(state.message ?? '草稿已建立')
      router.push(state.redirectTo)
    }
    if (state.error) toast(state.error, 'error')
  }, [state, toast, router])

  return (
    <form action={formAction} className="max-w-xl border border-cream-200 bg-white p-5">
      <Field
        label="標題"
        htmlFor="title"
        required
        error={state.fieldErrors?.title}
        hint="網址代稱會從標題自動產生，之後可以在編輯頁修改"
      >
        <Input id="title" name="title" maxLength={200} required autoFocus />
      </Field>

      <div className="mt-5 flex justify-end">
        <Button type="submit" disabled={pending || state.ok}>
          <Plus size={15} />
          {pending ? '建立中…' : state.ok ? '前往編輯頁…' : '建立草稿'}
        </Button>
      </div>
    </form>
  )
}
