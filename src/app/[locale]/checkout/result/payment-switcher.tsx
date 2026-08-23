'use client'

import * as React from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { CreditCard, Building, Barcode, ScanBarcode, Banknote, Landmark, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Field } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { changePaymentAction, type OrderActionState } from './actions'

const ICONS = {
  Credit: CreditCard,
  ATM: Building,
  CVS: Barcode,
  BARCODE: ScanBarcode,
  BANK: Landmark,
  COD: Banknote,
} as const

export type SwitchableChoice = keyof typeof ICONS

const INITIAL: OrderActionState = { ok: false }

/**
 * 待付款訂單改用其他付款方式。
 *
 * 這是「已經取號了卻想改」的解法。舊的做法是直接不給改（重送會產生第二組
 * 虛擬帳號），代價是消費者只能等訂單逾期再重新下單。現在改成明確地換一筆
 * 付款紀錄、把舊代碼標成作廢，並在後端保留舊代碼的比對能力
 * （見 lib/orders/payment-method.ts）。
 */
export function PaymentSwitcher({
  orderNo,
  choices,
  currentChoice,
  codFee,
  needsContact,
}: {
  orderNo: string
  choices: SwitchableChoice[]
  currentChoice: string
  codFee: number
  /** 訪客（訂單沒有綁會員，或不是本人登入）要輸入 Email／手機確認身分 */
  needsContact: boolean
}) {
  const t = useTranslations('result')
  const tCheckout = useTranslations('checkout')
  const router = useRouter()
  const [state, formAction, pending] = useActionState(changePaymentAction, INITIAL)
  const [open, setOpen] = React.useState(false)
  const [choice, setChoice] = React.useState<SwitchableChoice | null>(null)

  React.useEffect(() => {
    if (state.ok && state.redirectTo) window.location.assign(state.redirectTo)
  }, [state.ok, state.redirectTo])

  // 改成匯款：帳號與期限就印在這一頁上，要重新取一次才看得到
  React.useEffect(() => {
    if (state.ok && state.refresh) router.refresh()
  }, [state.ok, state.refresh, router])

  const selectable = choices.filter((c) => c !== currentChoice)
  if (selectable.length === 0) return null

  if (state.ok && state.message) {
    return (
      <section className="mt-10 border border-cream-300 bg-white p-6">
        <p className="text-sm text-ink-900">{state.message}</p>
      </section>
    )
  }

  return (
    <section className="mt-10 border border-cream-300 bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm tracking-[0.1em]">{t('changePaymentTitle')}</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-taupe-600">
            {t('changePaymentHint')}
          </p>
        </div>
        {!open && (
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            <RefreshCw size={14} />
            {t('changePaymentAction')}
          </Button>
        )}
      </div>

      {open && (
        <form action={formAction} className="mt-5">
          <input type="hidden" name="orderNo" value={orderNo} />
          <input type="hidden" name="choice" value={choice ?? ''} />

          <div className="grid gap-2 sm:grid-cols-2">
            {selectable.map((value) => {
              const Icon = ICONS[value]
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setChoice(value)}
                  className={cn(
                    'flex items-center gap-2 border p-3 text-left text-sm transition-colors',
                    choice === value
                      ? 'border-ink-900 bg-cream-50'
                      : 'border-cream-300 hover:border-taupe-400',
                  )}
                >
                  <Icon size={15} strokeWidth={1.5} />
                  <span>
                    {tCheckout(LABEL_KEYS[value])}
                    {value === 'COD' && codFee > 0 && (
                      <span className="ml-1 text-xs text-taupe-500">+{codFee}</span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>

          {needsContact && (
            <div className="mt-4">
              <Field label={t('contactLabel')} htmlFor="switch-contact" required>
                <Input
                  id="switch-contact"
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
            <Button type="submit" size="sm" disabled={pending || !choice}>
              {pending ? tCheckout('processingShort') : t('changePaymentConfirm')}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      )}
    </section>
  )
}

const LABEL_KEYS = {
  Credit: 'credit',
  ATM: 'atm',
  CVS: 'cvsPayment',
  BARCODE: 'barcode',
  BANK: 'bankTransfer',
  COD: 'cod',
} as const
