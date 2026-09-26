import { getPaymentSettings, getShippingSettings } from '@/lib/shop-settings'
import { PageHeader } from '@/components/admin/ui'
import { PaymentSettingsForm } from './payment-settings-form'
import { ShippingSettingsForm } from './shipping-settings-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: '設定' }

export default async function AdminSettingsPage() {
  const [payment, shipping] = await Promise.all([getPaymentSettings(), getShippingSettings()])

  return (
    <>
      <PageHeader
        title="商店設定"
        description="改動後立即生效，不需要重新部署。金鑰與網域仍在環境變數裡（見 docs/deploy.md）。"
      />
      <div className="space-y-10">
        <ShippingSettingsForm settings={shipping} />
        <PaymentSettingsForm settings={payment} />
      </div>
    </>
  )
}
