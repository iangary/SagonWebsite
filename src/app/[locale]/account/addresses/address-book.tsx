'use client'

import * as React from 'react'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import type { Address } from '@prisma/client'
import { Plus, Trash2, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select, Field } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { saveAddress, deleteAddress, type ActionState } from '../actions'

/**
 * 縣市送出的值必須是中文 —— 綠界與黑貓的地址欄位只吃中文。
 * 只有顯示用的文字依語系翻（見 messages 的 cities）。
 */
const CITIES = [
  '台北市', '新北市', '桃園市', '台中市', '台南市', '高雄市',
  '基隆市', '新竹市', '新竹縣', '苗栗縣', '彰化縣', '南投縣',
  '雲林縣', '嘉義市', '嘉義縣', '屏東縣', '宜蘭縣', '花蓮縣',
  '台東縣', '澎湖縣', '金門縣', '連江縣',
]

const INITIAL: ActionState = { ok: false }

export function AddressBook({ addresses }: { addresses: Address[] }) {
  const t = useTranslations('account')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const { toast } = useToast()
  const [editing, setEditing] = React.useState<Address | null>(null)
  const [creating, setCreating] = React.useState(false)

  async function remove(id: string) {
    if (!window.confirm(t('confirmDeleteAddress'))) return
    const result = await deleteAddress(id)
    if (!result.ok) {
      toast(result.error ?? t('deleteFailed'), 'error')
      return
    }
    toast(t('addressDeleted'))
    router.refresh()
  }

  const showForm = creating || editing !== null

  return (
    <div className="space-y-5">
      {!showForm && (
        <Button onClick={() => setCreating(true)}>
          <Plus size={15} />
          {t('addAddress')}
        </Button>
      )}

      {showForm && (
        <AddressForm
          address={editing}
          onDone={() => {
            setEditing(null)
            setCreating(false)
            router.refresh()
          }}
          onCancel={() => {
            setEditing(null)
            setCreating(false)
          }}
        />
      )}

      {addresses.length === 0 && !showForm ? (
        <p className="border border-cream-200 bg-white py-16 text-center text-sm text-taupe-500">
          {t('noAddresses')}
        </p>
      ) : (
        <ul className="space-y-3">
          {addresses.map((address) => (
            <li
              key={address.id}
              className="flex items-start justify-between gap-4 border border-cream-200 bg-white p-5"
            >
              <div className="min-w-0 text-sm">
                <p className="flex items-center gap-2 text-ink-900">
                  {address.recipient}
                  {address.isDefault && <Badge tone="neutral">{t('defaultAddress')}</Badge>}
                </p>
                <p className="mt-1 text-taupe-600">{address.phone}</p>
                <p className="mt-1 text-taupe-600">
                  {address.zip} {address.city}
                  {address.district}
                  {address.line1}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditing(address)}>
                  <Pencil size={13} />
                  {tCommon('edit')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(address.id)}>
                  <Trash2 size={13} />
                  {tCommon('delete')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function AddressForm({
  address,
  onDone,
  onCancel,
}: {
  address: Address | null
  onDone: () => void
  onCancel: () => void
}) {
  const t = useTranslations('account')
  const tCommon = useTranslations('common')
  const tCity = useTranslations('cities')
  const { toast } = useToast()
  const [state, formAction, pending] = useActionState(saveAddress, INITIAL)

  React.useEffect(() => {
    if (state.ok && state.message) {
      toast(state.message)
      onDone()
    }
    if (state.error) toast(state.error, 'error')
  }, [state, toast, onDone])

  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction} className="border border-cream-200 bg-white p-6">
      <input type="hidden" name="id" value={address?.id ?? ''} />
      <h2 className="mb-5 text-sm tracking-[0.1em]">
        {address ? t('editAddress') : t('addAddress')}
      </h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('recipient')} htmlFor="recipient" required error={errors.recipient}>
          <Input id="recipient" name="recipient" defaultValue={address?.recipient} required />
        </Field>
        <Field label={t('phone')} htmlFor="phone" required error={errors.phone}>
          <Input
            id="phone"
            name="phone"
            type="tel"
            inputMode="numeric"
            defaultValue={address?.phone}
            placeholder="09xxxxxxxx"
            required
          />
        </Field>
        <Field label={t('addressZip')} htmlFor="zip" required error={errors.zip}>
          <Input id="zip" name="zip" inputMode="numeric" maxLength={5} defaultValue={address?.zip} required />
        </Field>
        <Field label={t('addressCity')} htmlFor="city" required error={errors.city}>
          <Select id="city" name="city" defaultValue={address?.city ?? ''} required>
            <option value="">{t('selectPlaceholder')}</option>
            {CITIES.map((city) => (
              <option key={city} value={city}>
                {tCity(city)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('addressDistrict')} htmlFor="district" required error={errors.district}>
          <Input id="district" name="district" defaultValue={address?.district} required />
        </Field>
        <div className="sm:col-span-2">
          <Field label={t('addressLine')} htmlFor="line1" required error={errors.line1}>
            <Input id="line1" name="line1" defaultValue={address?.line1} required />
          </Field>
        </div>
      </div>

      <label className="mt-4 flex cursor-pointer items-center gap-2 text-sm text-ink-700">
        <input
          type="checkbox"
          name="isDefault"
          defaultChecked={address?.isDefault ?? false}
          className="size-3.5 accent-[#2b2724]"
        />
        {t('setAsDefault')}
      </label>

      <div className="mt-6 flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? t('saving') : tCommon('save')}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {tCommon('cancel')}
        </Button>
      </div>
    </form>
  )
}
