'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { PaymentSettings } from '@/lib/shop-settings'
import { saveSettingsAction, type SettingsState } from './actions'

const INITIAL: SettingsState = { ok: false }

/**
 * 付款設定表單。
 *
 * 這些值以前寫在環境變數裡（改一次要重新部署），現在存在 shop_settings，
 * 店長自己就能調整。金鑰與網域仍然是環境變數 —— 那些不該讓後台改得動。
 */
export function PaymentSettingsForm({ settings }: { settings: PaymentSettings }) {
  const [state, formAction, pending] = useActionState(saveSettingsAction, INITIAL)

  return (
    <form action={formAction} className="space-y-6">
      <Section
        title="線上付款（需先付款）"
        note="關掉之後結帳頁只會剩下貨到付款。"
      >
        <Check name="prepayEnabled" label="開放線上付款" defaultChecked={settings.prepayEnabled} />
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Check name="method_Credit" label="信用卡" defaultChecked={settings.methods.Credit} />
          <Check name="method_ATM" label="ATM 虛擬帳號" defaultChecked={settings.methods.ATM} />
          <Check name="method_CVS" label="超商代碼繳費" defaultChecked={settings.methods.CVS} />
          <Check
            name="method_BARCODE"
            label="超商條碼繳費"
            defaultChecked={settings.methods.BARCODE}
          />
        </div>
      </Section>

      <Section
        title="付款期限"
        note="期限就是庫存要保留的時間 —— 拉長對消費者友善，但同一批貨會被未付款的訂單佔住更久。綠界上限 30 天。"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            name="cvsExpireDays"
            label="超商代碼／條碼（天）"
            defaultValue={settings.cvsExpireDays}
            min={1}
            max={30}
          />
          <NumberField
            name="atmExpireDays"
            label="ATM 虛擬帳號（天）"
            defaultValue={settings.atmExpireDays}
            min={1}
            max={30}
          />
        </div>
      </Section>

      <Section
        title="貨到付款"
        note="貨款由物流代收（超商取貨付款／黑貓代收貨款），需先在綠界物流與黑貓開通代收服務。超商代收上限為 20,000 元。"
      >
        <Check name="codEnabled" label="開放貨到付款" defaultChecked={settings.codEnabled} />
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Check
            name="cod_CVS"
            label="超商取貨可貨到付款"
            defaultChecked={settings.codShippingMethods.includes('CVS')}
          />
          <Check
            name="cod_HOME"
            label="宅配可貨到付款"
            defaultChecked={settings.codShippingMethods.includes('HOME')}
          />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <NumberField
            name="codFee"
            label="手續費（元，0 = 不加收）"
            defaultValue={settings.codFee}
            min={0}
            max={1000}
          />
          <NumberField
            name="codMaxAmount"
            label="金額上限（元）"
            defaultValue={settings.codMaxAmount}
            min={1}
            max={100000}
          />
        </div>
      </Section>

      <Section
        title="退款期限"
        note="退款一律走 LINE 客服，前台沒有線上申請表單。這個天數是政策數字：訂單頁據此顯示客服入口，後台開退款單時也用它擋過期的個案（客服可以明確跨過）。期限從「已取貨」開始算，還沒收到貨的訂單不受限制。"
      >
        <div className="max-w-xs">
          <NumberField
            name="refundWindowDays"
            label="取貨後可退款天數"
            defaultValue={settings.refundWindowDays}
            min={1}
            max={90}
          />
        </div>
      </Section>

      {state.error && (
        <p role="alert" className="border border-sale/30 bg-sale/5 px-4 py-3 text-sm text-sale">
          {state.error}
        </p>
      )}
      {state.ok && state.message && (
        <p className="border border-cream-300 bg-white px-4 py-3 text-sm text-ink-900">
          {state.message}
        </p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? '儲存中…' : '儲存設定'}
      </Button>
    </form>
  )
}

function Section({
  title,
  note,
  children,
}: {
  title: string
  note: string
  children: React.ReactNode
}) {
  return (
    <section className="border border-cream-200 bg-white p-5">
      <h2 className="text-sm tracking-[0.1em] text-ink-900">{title}</h2>
      <p className="mt-1.5 text-xs leading-relaxed text-taupe-600">{note}</p>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function Check({
  name,
  label,
  defaultChecked,
}: {
  name: string
  label: string
  defaultChecked: boolean
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-900">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="size-4 accent-[#2b2724]"
      />
      {label}
    </label>
  )
}

function NumberField({
  name,
  label,
  defaultValue,
  min,
  max,
}: {
  name: string
  label: string
  defaultValue: number
  min: number
  max: number
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium tracking-wide text-ink-700">{label}</span>
      <Input
        name={name}
        type="number"
        inputMode="numeric"
        defaultValue={defaultValue}
        min={min}
        max={max}
      />
    </label>
  )
}
