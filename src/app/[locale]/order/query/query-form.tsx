'use client'

import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Field } from '@/components/ui/input'
import { queryOrder, type OrderQueryState } from './actions'

const INITIAL: OrderQueryState = {}

/**
 * 用 POST 送出（Server Action），手機與 Email 不會留在網址列與伺服器 log 裡。
 * 查到的結果由 page.tsx 從 cookie 讀出來顯示，重新整理也還在。
 */
export function OrderQueryForm({
  defaultOrderNo,
  defaultContact,
}: {
  defaultOrderNo: string
  defaultContact: string
}) {
  const t = useTranslations('orderQuery')
  const [state, formAction, pending] = useActionState(queryOrder, INITIAL)

  return (
    <>
      <form action={formAction} className="mt-8 space-y-4">
        <Field label={t('orderNo')} htmlFor="orderNo" required>
          <Input
            id="orderNo"
            name="orderNo"
            defaultValue={defaultOrderNo}
            placeholder={t('orderNoPlaceholder')}
            className="font-mono"
            required
          />
        </Field>

        <Field label={t('contact')} htmlFor="contact" required hint={t('contactHint')}>
          <Input
            id="contact"
            name="contact"
            defaultValue={defaultContact}
            placeholder={t('contactPlaceholder')}
            required
          />
        </Field>

        <Button type="submit" size="lg" disabled={pending}>
          <Search size={16} />
          {t('submit')}
        </Button>
      </form>

      {state.error && (
        <p className="mt-8 border border-sale/30 bg-sale/5 px-4 py-3 text-sm text-sale">
          {state.error}
        </p>
      )}
    </>
  )
}
