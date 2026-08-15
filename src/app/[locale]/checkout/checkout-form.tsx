'use client'

import * as React from 'react'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import Image from 'next/image'
import { Store, Truck, Check, CreditCard, Building, Barcode } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Textarea, Select, Field } from '@/components/ui/input'
import { calculatePricing } from '@/lib/orders/pricing'
import { formatTWD, cn } from '@/lib/utils'
import { submitCheckout, type CheckoutState } from './actions'

type Item = {
  id: string
  qty: number
  unitPrice: number
  productName: string
  variantName: string
  imageUrl: string | null
}

type CvsStore = {
  subType: string
  storeId: string
  storeName: string
  address: string
  telephone: string
}

const CVS_OPTIONS = ['UNIMARTC2C', 'FAMIC2C', 'HILIFEC2C', 'OKMARTC2C'] as const
const HOME_OPTIONS = ['TCAT', 'POST'] as const

const PAYMENT_OPTIONS = [
  { value: 'Credit', labelKey: 'credit', noteKey: 'creditNote', icon: CreditCard },
  { value: 'ATM', labelKey: 'atm', noteKey: 'atmNote', icon: Building },
  { value: 'CVS', labelKey: 'cvsPayment', noteKey: 'cvsPaymentNote', icon: Barcode },
] as const

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

const INITIAL: CheckoutState = { ok: false }

export function CheckoutForm({
  items,
  couponCode,
  defaultEmail,
  defaultAddress,
  shippingFees,
  freeShippingThreshold,
}: {
  items: Item[]
  couponCode: string | null
  defaultEmail: string
  defaultAddress: {
    recipient: string
    phone: string
    zip: string
    city: string
    district: string
    line1: string
  } | null
  shippingFees: { CVS: number; HOME: number }
  freeShippingThreshold: number
}) {
  const t = useTranslations('checkout')
  const tCart = useTranslations('cart')
  const tCvs = useTranslations('cvsBrand')
  const tLogistics = useTranslations('logistics')
  const tCity = useTranslations('cities')
  const [state, formAction, pending] = useActionState(submitCheckout, INITIAL)

  const [shippingMethod, setShippingMethod] = React.useState<'CVS' | 'HOME'>('CVS')
  const [cvsSubType, setCvsSubType] = React.useState('UNIMARTC2C')
  const [homeSubType, setHomeSubType] = React.useState('TCAT')
  const [store, setStore] = React.useState<CvsStore | null>(null)
  const [invoiceType, setInvoiceType] = React.useState<'PERSONAL' | 'COMPANY'>('PERSONAL')

  // 成功後導向綠界收銀台。用 location.assign 而不是 router.push，
  // 因為目標是一支會回 HTML 表單的 route handler，不是 Next 的頁面。
  React.useEffect(() => {
    if (state.ok && state.redirectTo) window.location.assign(state.redirectTo)
  }, [state.ok, state.redirectTo])

  // 接收綠界電子地圖選店的結果
  React.useEffect(() => {
    // 開地圖時發的一次性 token（存在 sessionStorage），選店結果回來要對得上
    // 才收 —— 擋掉其他分頁或過期視窗塞進來的門市資料。
    function tokenMatches(token: string | undefined): boolean {
      try {
        const expected = sessionStorage.getItem('ecpay:cvs-map-token')
        return Boolean(expected) && token === expected
      } catch {
        // sessionStorage 被停用時退回舊行為（不驗 token），至少 origin 已經驗過
        return true
      }
    }

    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return
      const data = event.data as { type?: string; store?: CvsStore; token?: string }
      if (data?.type !== 'ecpay:cvs-store-selected' || !data.store) return
      if (!tokenMatches(data.token)) return
      setStore(data.store)
      setCvsSubType(data.store.subType)
    }
    window.addEventListener('message', onMessage)

    // 手機上可能沒有 opener，改由 sessionStorage 傳遞
    try {
      const cached = sessionStorage.getItem('ecpay:cvs-store')
      if (cached) {
        const parsed = JSON.parse(cached) as { store?: CvsStore; token?: string } | CvsStore
        // 新格式是 { store, token }，兼容舊格式（直接是門市物件）
        const store = 'store' in parsed && parsed.store ? parsed.store : (parsed as CvsStore)
        const token = 'token' in parsed ? parsed.token : undefined
        if (store.storeId && tokenMatches(token)) {
          setStore(store)
          setCvsSubType(store.subType)
        }
        sessionStorage.removeItem('ecpay:cvs-store')
      }
    } catch {
      // sessionStorage 被停用就算了，使用者重選一次即可
    }

    return () => window.removeEventListener('message', onMessage)
  }, [])

  function openStoreMap() {
    let token = ''
    try {
      token = crypto.randomUUID()
      sessionStorage.setItem('ecpay:cvs-map-token', token)
    } catch {
      // 沒有 sessionStorage 就不帶 token，map-reply 會原樣帶回空字串
    }
    const url = `/api/ecpay/logistics/map?subType=${cvsSubType}&token=${token}`
    window.open(url, 'ecpay-cvs-map', 'width=1000,height=720,menubar=no,toolbar=no')
  }

  // 前端即時試算，最終金額仍以伺服器端的 createOrderFromCart 為準
  const pricing = calculatePricing({
    lines: items.map((i) => ({ variantId: i.id, unitPrice: i.unitPrice, qty: i.qty })),
    shippingMethod,
    shippingFees,
    freeShippingThreshold,
  })

  const errors = state.fieldErrors ?? {}

  return (
    <form action={formAction} className="mt-10 gap-12 lg:flex lg:items-start">
      {/* 隱藏欄位：把選店結果與購物車折扣碼一起送出 */}
      <input type="hidden" name="shippingMethod" value={shippingMethod} />
      <input
        type="hidden"
        name="logisticsSubType"
        value={shippingMethod === 'CVS' ? cvsSubType : homeSubType}
      />
      <input type="hidden" name="cvsStoreId" value={store?.storeId ?? ''} />
      <input type="hidden" name="cvsStoreName" value={store?.storeName ?? ''} />
      <input type="hidden" name="cvsAddress" value={store?.address ?? ''} />
      <input type="hidden" name="cvsTelephone" value={store?.telephone ?? ''} />
      <input type="hidden" name="couponCode" value={couponCode ?? ''} />
      <input type="hidden" name="invoiceType" value={invoiceType} />

      <div className="flex-1 space-y-12">
        {state.error && (
          <p role="alert" className="border border-sale/30 bg-sale/5 px-4 py-3 text-sm text-sale">
            {state.error}
          </p>
        )}

        {/* 收件資訊 */}
        <section>
          <SectionTitle step={1} title={t('recipient')} />
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <Field
              label={t('recipientName')}
              htmlFor="recipientName"
              required
              error={errors.recipientName}
            >
              <Input
                id="recipientName"
                name="recipientName"
                defaultValue={defaultAddress?.recipient ?? ''}
                autoComplete="name"
                required
              />
            </Field>
            <Field
              label={t('recipientPhone')}
              htmlFor="recipientPhone"
              required
              error={errors.recipientPhone}
              hint={t('recipientPhoneHint')}
            >
              <Input
                id="recipientPhone"
                name="recipientPhone"
                type="tel"
                inputMode="numeric"
                defaultValue={defaultAddress?.phone ?? ''}
                placeholder="09xxxxxxxx"
                autoComplete="tel"
                required
              />
            </Field>
            <div className="sm:col-span-2">
              <Field
                label={t('email')}
                htmlFor="email"
                required
                error={errors.email}
                hint={t('emailHint')}
              >
                <Input
                  id="email"
                  name="email"
                  type="email"
                  defaultValue={defaultEmail}
                  autoComplete="email"
                  required
                />
              </Field>
            </div>
          </div>
        </section>

        {/* 配送方式 */}
        <section>
          <SectionTitle step={2} title={t('shippingMethod')} />
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <MethodCard
              active={shippingMethod === 'CVS'}
              onClick={() => setShippingMethod('CVS')}
              icon={<Store size={18} strokeWidth={1.5} />}
              title={t('cvs')}
              note={t('shippingFeeNote', { amount: formatTWD(shippingFees.CVS) })}
            />
            <MethodCard
              active={shippingMethod === 'HOME'}
              onClick={() => setShippingMethod('HOME')}
              icon={<Truck size={18} strokeWidth={1.5} />}
              title={t('home')}
              note={t('shippingFeeNote', { amount: formatTWD(shippingFees.HOME) })}
            />
          </div>

          {shippingMethod === 'CVS' ? (
            <div className="mt-6 space-y-4">
              <Field label={t('cvsChannel')} htmlFor="cvsSubType" required>
                <Select
                  id="cvsSubType"
                  value={cvsSubType}
                  onChange={(e) => {
                    setCvsSubType(e.target.value)
                    // 換通路後原本的門市就無效了
                    setStore(null)
                  }}
                >
                  {CVS_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {tCvs(value)}
                    </option>
                  ))}
                </Select>
              </Field>

              <div>
                {store ? (
                  <div className="flex items-start justify-between gap-4 border border-cream-300 bg-white p-4">
                    <div className="text-sm">
                      <p className="flex items-center gap-1.5 text-ink-900">
                        <Check size={14} className="text-taupe-500" />
                        {store.storeName}
                      </p>
                      <p className="mt-1 text-xs text-taupe-500">
                        {t('storeCode', { id: store.storeId })}
                      </p>
                      <p className="mt-0.5 text-xs text-taupe-500">{store.address}</p>
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={openStoreMap}>
                      {t('changeStore')}
                    </Button>
                  </div>
                ) : (
                  <Button type="button" variant="outline" onClick={openStoreMap} full>
                    <Store size={16} />
                    {t('pickStore')}
                  </Button>
                )}
                {errors.cvsStoreId && <p className="mt-1.5 text-xs text-sale">{errors.cvsStoreId}</p>}
              </div>
            </div>
          ) : (
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <Field label={t('carrier')} htmlFor="homeSubType" required>
                <Select
                  id="homeSubType"
                  value={homeSubType}
                  onChange={(e) => setHomeSubType(e.target.value)}
                >
                  {HOME_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {tLogistics(value)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label={t('addressZip')}
                htmlFor="addressZip"
                required
                error={errors.addressZip}
              >
                <Input
                  id="addressZip"
                  name="addressZip"
                  inputMode="numeric"
                  maxLength={5}
                  defaultValue={defaultAddress?.zip ?? ''}
                  autoComplete="postal-code"
                />
              </Field>
              <Field
                label={t('addressCity')}
                htmlFor="addressCity"
                required
                error={errors.addressCity}
              >
                <Select
                  id="addressCity"
                  name="addressCity"
                  defaultValue={defaultAddress?.city ?? ''}
                >
                  <option value="">{t('selectPlaceholder')}</option>
                  {CITIES.map((city) => (
                    <option key={city} value={city}>
                      {tCity(city)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label={t('addressDistrict')}
                htmlFor="addressDistrict"
                required
                error={errors.addressDistrict}
              >
                <Input
                  id="addressDistrict"
                  name="addressDistrict"
                  defaultValue={defaultAddress?.district ?? ''}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field
                  label={t('addressLine')}
                  htmlFor="addressLine"
                  required
                  error={errors.addressLine}
                >
                  <Input
                    id="addressLine"
                    name="addressLine"
                    defaultValue={defaultAddress?.line1 ?? ''}
                    autoComplete="street-address"
                  />
                </Field>
              </div>
            </div>
          )}
        </section>

        {/* 付款方式 */}
        <section>
          <SectionTitle step={3} title={t('paymentMethod')} />
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {PAYMENT_OPTIONS.map((option, i) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-start gap-3 border border-cream-300 p-4 transition-colors has-checked:border-ink-900 has-checked:bg-white"
              >
                <input
                  type="radio"
                  name="choosePayment"
                  value={option.value}
                  defaultChecked={i === 0}
                  className="mt-0.5 accent-[#2b2724]"
                />
                <span>
                  <span className="flex items-center gap-1.5 text-sm text-ink-900">
                    <option.icon size={15} strokeWidth={1.5} />
                    {t(option.labelKey)}
                  </span>
                  <span className="mt-1 block text-xs text-taupe-500">{t(option.noteKey)}</span>
                </span>
              </label>
            ))}
          </div>
        </section>

        {/* 發票 */}
        <section>
          <SectionTitle step={4} title={t('invoice')} />
          <p className="mt-4 text-xs text-taupe-500">{t('invoiceNote')}</p>
          <div className="mt-6 space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { value: 'PERSONAL', label: t('invoicePersonal'), note: t('invoicePersonalNote') },
                { value: 'COMPANY', label: t('invoiceCompany'), note: t('invoiceCompanyNote') },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setInvoiceType(option.value as typeof invoiceType)}
                  className={cn(
                    'border p-3 text-left transition-colors',
                    invoiceType === option.value
                      ? 'border-ink-900 bg-white'
                      : 'border-cream-300 hover:border-taupe-400',
                  )}
                >
                  <span className="block text-sm text-ink-900">{option.label}</span>
                  <span className="mt-0.5 block text-xs text-taupe-500">{option.note}</span>
                </button>
              ))}
            </div>

            {invoiceType === 'COMPANY' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('taxId')} htmlFor="taxId" required error={errors.taxId}>
                  <Input id="taxId" name="taxId" inputMode="numeric" maxLength={8} />
                </Field>
                <Field
                  label={t('companyName')}
                  htmlFor="companyName"
                  required
                  error={errors.companyName}
                >
                  <Input id="companyName" name="companyName" />
                </Field>
              </div>
            )}
          </div>
        </section>

        <section>
          <Field label={t('note')} htmlFor="note" hint={t('noteHint')}>
            <Textarea id="note" name="note" maxLength={500} />
          </Field>
        </section>
      </div>

      {/* 訂單摘要 */}
      <aside className="mt-12 lg:mt-0 lg:w-80 lg:shrink-0">
        <div className="bg-cream-100 p-6 lg:sticky lg:top-32">
          <h2 className="text-sm tracking-[0.12em]">{t('orderSummary')}</h2>

          <ul className="mt-5 space-y-4 border-b border-cream-200 pb-5">
            {items.map((item) => (
              <li key={item.id} className="flex gap-3">
                <div className="relative size-14 shrink-0 overflow-hidden bg-cream-200">
                  {item.imageUrl && (
                    <Image
                      src={item.imageUrl}
                      alt=""
                      fill
                      sizes="56px"
                      className="object-cover"
                    />
                  )}
                  <span className="absolute -right-1 -top-1 flex size-4.5 items-center justify-center rounded-full bg-ink-900 px-1 text-[10px] leading-none text-cream-50">
                    {item.qty}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-xs leading-relaxed text-ink-900">
                    {item.productName}
                  </p>
                  <p className="mt-0.5 text-[11px] text-taupe-500">{item.variantName}</p>
                </div>
                <span className="shrink-0 text-xs tabular-nums text-ink-700">
                  {formatTWD(item.unitPrice * item.qty)}
                </span>
              </li>
            ))}
          </ul>

          <dl className="mt-5 space-y-2.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-700">{tCart('subtotal')}</dt>
              <dd className="tabular-nums">{formatTWD(pricing.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-700">{tCart('shipping')}</dt>
              <dd className="tabular-nums">
                {pricing.shippingFee === 0
                  ? tCart('freeShipping')
                  : formatTWD(pricing.shippingFee)}
              </dd>
            </div>
            {couponCode && (
              <div className="flex justify-between text-xs text-taupe-600">
                <dt>{tCart('couponCode')}</dt>
                <dd>{t('couponPending', { code: couponCode })}</dd>
              </div>
            )}
          </dl>

          <div className="mt-5 flex items-baseline justify-between border-t border-cream-200 pt-5">
            <span className="text-sm">{t('amountDue')}</span>
            <span className="text-xl tabular-nums">{formatTWD(pricing.grandTotal)}</span>
          </div>

          <Button type="submit" size="lg" full className="mt-6" disabled={pending || state.ok}>
            {pending ? t('processingShort') : state.ok ? t('redirecting') : t('placeOrder')}
          </Button>

          <p className="mt-3 text-center text-[11px] leading-relaxed text-taupe-500">
            {t('securityNote')}
            <br />
            {t('reserveNote')}
          </p>
        </div>
      </aside>
    </form>
  )
}

function SectionTitle({ step, title }: { step: number; title: string }) {
  return (
    <h2 className="flex items-center gap-3 border-b border-cream-200 pb-3 text-base tracking-[0.1em]">
      <span className="flex size-6 items-center justify-center rounded-full bg-ink-900 text-xs text-cream-50">
        {step}
      </span>
      {title}
    </h2>
  )
}

function MethodCard({
  active,
  onClick,
  icon,
  title,
  note,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  title: string
  note: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-3 border p-4 text-left transition-colors',
        active ? 'border-ink-900 bg-white' : 'border-cream-300 hover:border-taupe-400',
      )}
    >
      <span className={active ? 'text-ink-900' : 'text-taupe-500'}>{icon}</span>
      <span>
        <span className="block text-sm text-ink-900">{title}</span>
        <span className="mt-0.5 block text-xs text-taupe-500">{note}</span>
      </span>
    </button>
  )
}
