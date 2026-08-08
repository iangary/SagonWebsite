import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Mail, Clock, Building2, Package } from 'lucide-react'
import { Link } from '@/i18n/routing'
import { env } from '@/lib/env'

export const revalidate = 3600

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'nav' })
  return { title: t('contact'), alternates: { canonical: '/contact' } }
}

export default async function ContactPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  const channels = [
    {
      icon: Mail,
      title: '客服信箱',
      body: 'service@sagon.local',
      note: '一般問題會在 1 個工作天內回覆',
    },
    {
      icon: Clock,
      title: '客服時間',
      body: '週一至週五 10:00–18:00',
      note: '例假日與國定假日休息，不出貨',
    },
    {
      icon: Building2,
      title: '公司資訊',
      body: `${env.SHOP_NAME}（統編 ${env.SHOP_TAX_ID}）`,
      note: '台北市中山區',
    },
  ]

  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <p className="text-xs tracking-[0.3em] text-taupe-600 uppercase">Contact</p>
      <h1 className="mt-4 text-3xl">聯絡我們</h1>
      <p className="mt-5 text-sm leading-loose text-ink-700">
        對商品尺寸、材質或訂單有任何疑問，歡迎透過以下方式與我們聯繫。
        來信時請附上訂單編號，可以加快處理速度。
      </p>

      <ul className="mt-12 space-y-px bg-cream-200">
        {channels.map((channel) => (
          <li key={channel.title} className="flex items-start gap-4 bg-cream-50 p-6">
            <channel.icon size={20} strokeWidth={1.5} className="mt-0.5 shrink-0 text-taupe-500" />
            <div>
              <p className="text-xs tracking-wide text-taupe-600">{channel.title}</p>
              <p className="mt-1 text-sm text-ink-900">{channel.body}</p>
              <p className="mt-1 text-xs text-taupe-500">{channel.note}</p>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-10 flex items-start gap-4 border border-cream-300 p-6">
        <Package size={20} strokeWidth={1.5} className="mt-0.5 shrink-0 text-taupe-500" />
        <div>
          <p className="text-sm text-ink-900">想查詢訂單狀態？</p>
          <p className="mt-1 text-sm text-ink-700">
            不需要來信，直接用訂單編號加上下單時填的手機或 Email 就能查詢。
          </p>
          <Link
            href="/order/query"
            className="mt-3 inline-block text-sm text-ink-900 underline underline-offset-4"
          >
            前往訂單查詢
          </Link>
        </div>
      </div>
    </div>
  )
}
