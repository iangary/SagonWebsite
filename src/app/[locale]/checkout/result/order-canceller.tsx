'use client'

import * as React from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Field } from '@/components/ui/input'
import { cancelOrderAction, type OrderActionState } from './actions'

const INITIAL: OrderActionState = { ok: false }

/**
 * 待付款訂單由消費者自己取消。
 *
 * 多一步確認：取消後庫存會立刻放出去，同一件商品可能被別人買走，按錯了沒辦法復原。
 */
export function OrderCanceller({
  orderNo,
  needsContact,
  hasPaymentCode,
}: {
  orderNo: string
  /** 訪客（訂單沒有綁會員，或不是本人登入）要輸入 Email／手機確認身分 */
  needsContact: boolean
  /** 已經拿到 ATM 帳號／超商代碼／匯款資訊 —— 要提醒「繳了就別取消」 */
  hasPaymentCode: boolean
}) {
  const t = useTranslations('result')
  const tCheckout = useTranslations('checkout')
  const router = useRouter()
  const [state, formAction, pending] = useActionState(cancelOrderAction, INITIAL)
  const [open, setOpen] = React.useState(false)

  // 取消成功（或發現訂單其實已經付款）時整頁狀態都變了，重新取一次
  React.useEffect(() => {
    if (state.refresh) router.refresh()
  }, [state, router])

  if (state.ok) return null

  return (
    <section className="mt-10 border border-cream-300 bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm tracking-[0.1em]">{t('cancelOrderTitle')}</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-taupe-600">{t('cancelOrderHint')}</p>
        </div>
        {!open && (
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            <XCircle size={14} />
            {t('cancelOrderAction')}
          </Button>
        )}
      </div>

      {open && (
        <form action={formAction} className="mt-5">
          <input type="hidden" name="orderNo" value={orderNo} />

          <p className="text-sm leading-relaxed text-ink-900">{t('cancelOrderConfirmText')}</p>
          {hasPaymentCode && (
            <p className="mt-2 text-xs leading-relaxed text-sale">{t('cancelOrderPaidWarning')}</p>
          )}

          {needsContact && (
            <div className="mt-4">
              <Field label={t('contactLabel')} htmlFor="cancel-contact" required>
                <Input
                  id="cancel-contact"
                  name="contact"
                  placeholder={t('contactPlaceholder')}
                  autoComplete="email"
                  required
                />
              </Field>
            </div>
          )}

          {state.error && (
            <p role="alert" className="mt-4 text-sm text-sale">
              {state.error}
            </p>
          )}

          <div className="mt-5 flex gap-3">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? tCheckout('processingShort') : t('cancelOrderConfirm')}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              {t('cancelOrderKeep')}
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}
