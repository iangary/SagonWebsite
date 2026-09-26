'use client'

import { useActionState } from 'react'
import { Textarea } from '@/components/ui/input'
import type { PaymentSettings } from '@/lib/shop-settings'
import { saveSettingsAction, type SettingsState } from './actions'
import { Check, FormStatus, NumberField, Section, TextField } from './fields'

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
        note="期限就是庫存要保留的時間 —— 拉長對消費者友善，但同一批貨會被未付款的訂單佔住更久。綠界上限 30 天。信用卡當場刷完，分鐘數只是留給消費者在付款頁填卡號、過 3D 驗證。"
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
          <NumberField
            name="creditHoldMinutes"
            label="信用卡（分鐘）"
            defaultValue={settings.creditHoldMinutes}
            min={10}
            max={1440}
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
        title="匯款到公司帳戶"
        note="客人自己去 ATM／網銀轉帳到公司帳戶。錢不經綠界，所以沒有任何自動入帳通知 —— 要有人去看帳戶，再到訂單頁按「標記匯款已入帳」，訂單才會進備貨。後台訂單列表的「匯款待入帳」就是每天要對的那疊。"
      >
        <Check
          name="bankTransferEnabled"
          label="開放匯款付款"
          defaultChecked={settings.bankTransferEnabled}
        />
        <p className="mt-2 text-xs leading-relaxed text-taupe-600">
          帳戶資訊會顯示在訂單頁與通知信上。改帳號會立刻影響「還在等匯款」的訂單 ——
          那些客人看到的會是新帳號，舊帳號請確認還收得到款。
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <TextField
            name="bankName"
            label="銀行（含分行）"
            defaultValue={settings.bankName}
            placeholder="玉山銀行 內湖分行"
          />
          <TextField
            name="bankCode"
            label="銀行代號"
            defaultValue={settings.bankCode}
            placeholder="808"
            inputMode="numeric"
          />
          <TextField
            name="bankAccountNo"
            label="帳號"
            defaultValue={settings.bankAccountNo}
            placeholder="0123456789012"
            inputMode="numeric"
          />
          <TextField
            name="bankAccountName"
            label="戶名"
            defaultValue={settings.bankAccountName}
            placeholder="莎岡選品有限公司"
          />
          <NumberField
            name="bankExpireDays"
            label="匯款期限（天）"
            defaultValue={settings.bankExpireDays}
            min={1}
            max={30}
          />
        </div>
        <div className="mt-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium tracking-wide text-ink-700">
              補充說明（選填）
            </span>
            <Textarea
              name="bankTransferNote"
              rows={2}
              defaultValue={settings.bankTransferNote}
              placeholder="請在轉帳備註填訂單編號，我們才對得到您的款項。"
            />
          </label>
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

      <FormStatus state={state} pending={pending} label="儲存付款設定" />
    </form>
  )
}
