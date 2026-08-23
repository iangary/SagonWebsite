import { getPaymentSettings } from '@/lib/shop-settings'
import { PageHeader } from '@/components/admin/ui'
import { PaymentSettingsForm } from './payment-settings-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: '設定' }

export default async function AdminSettingsPage() {
  const settings = await getPaymentSettings()

  return (
    <>
      <PageHeader
        title="付款設定"
        description="改動後立即生效，不需要重新部署。金鑰與網域仍在環境變數裡（見 docs/deploy.md）。"
      />
      <PaymentSettingsForm settings={settings} />
    </>
  )
}
