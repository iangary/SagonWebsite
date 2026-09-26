'use client'

import { useActionState } from 'react'
import type { ShippingSettings } from '@/lib/shop-settings'
import { saveShippingSettingsAction, type SettingsState } from './actions'
import { FormStatus, NumberField, Section } from './fields'

const INITIAL: SettingsState = { ok: false }

/**
 * 運費設定表單。
 *
 * 以前是環境變數（SHIPPING_FEE_CVS／SHIPPING_FEE_HOME／FREE_SHIPPING_THRESHOLD），
 * 改一次要動主機檔案、重建容器。
 */
export function ShippingSettingsForm({ settings }: { settings: ShippingSettings }) {
  const [state, formAction, pending] = useActionState(saveShippingSettingsAction, INITIAL)

  return (
    <form action={formAction} className="space-y-6">
      <Section
        title="運費"
        note="綠界超商取貨實收 65 元、黑貓宅配本島 130 元起。運費設得比實收價低，差額由店家吸收；滿額免運時整筆運費都由店家吸收。改動只影響之後的新訂單，已成立的訂單照下單當時的運費。"
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <NumberField
            name="cvsFee"
            label="超商取貨（元）"
            defaultValue={settings.cvsFee}
            min={0}
            max={1000}
          />
          <NumberField
            name="homeFee"
            label="宅配（元）"
            defaultValue={settings.homeFee}
            min={0}
            max={1000}
          />
          <NumberField
            name="freeShippingThreshold"
            label="滿額免運門檻（元）"
            defaultValue={settings.freeShippingThreshold}
            min={1}
            max={100000}
          />
        </div>
      </Section>

      <FormStatus state={state} pending={pending} label="儲存運費設定" />
    </form>
  )
}
