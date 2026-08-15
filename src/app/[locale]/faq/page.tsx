import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { env } from '@/lib/env'
import { formatTWD } from '@/lib/utils'

export const revalidate = 3600

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'nav' })
  return { title: t('faq'), alternates: { canonical: '/faq' } }
}

export default async function FaqPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  const groups = [
    {
      title: '訂購與付款',
      items: [
        {
          q: '有哪些付款方式？',
          a: '本站透過綠界科技 ECPay 提供信用卡（可分期）、ATM 虛擬帳號轉帳、超商代碼繳費三種方式。ATM 與超商代碼會在下單後產生繳費資訊，請於期限內完成付款，逾期訂單將自動取消並釋放庫存。',
        },
        {
          q: '下單後可以修改訂單嗎？',
          a: '訂單成立後無法自行修改。若尚未出貨，請於客服時間內來信 service@sagon.local，並附上訂單編號，我們會協助處理。',
        },
        {
          q: '折扣碼要怎麼使用？',
          a: '在購物車頁面的「折扣碼」欄位輸入後按套用即可，折抵金額會即時反映在總計上。每張折扣碼有各自的使用門檻與次數限制，且一張訂單只能使用一組。',
        },
      ],
    },
    {
      title: '運送與取貨',
      items: [
        {
          q: '運費怎麼計算？',
          a: `超商取貨 ${formatTWD(env.SHIPPING_FEE_CVS)}、宅配到府 ${formatTWD(env.SHIPPING_FEE_HOME)}。單筆訂單消費滿 ${formatTWD(env.FREE_SHIPPING_THRESHOLD)} 即享免運。`,
        },
        {
          q: '多久會出貨？',
          a: '確認收到款項後的 1–3 個工作天內出貨（例假日順延）。出貨後會寄送通知信，您也可以在「會員中心 → 我的訂單」查看物流進度。',
        },
        {
          q: '支援哪些超商取貨？',
          a: '7-ELEVEN、全家、萊爾富、OK 超商皆可。結帳時選擇超商取貨後，會開啟綠界電子地圖供您選擇門市。商品到店後會收到簡訊通知，請於 7 日內完成取貨。',
        },
      ],
    },
    {
      title: '發票與退換貨',
      items: [
        {
          q: '發票怎麼開立？',
          a: '發票為紙本，開立後隨包裹一併寄出；需要公司統編（三聯式）請於結帳時填寫。另外，付款完成後系統會自動寄一份電子收據到您的信箱（電子收據非統一發票，不可作為報稅憑證）。',
        },
        {
          q: '可以退換貨嗎？',
          a: '依《消費者保護法》，您享有商品到貨後 7 天的鑑賞期（非試用期）。退回商品須為全新完整、包含原包裝與吊牌。基於衛生考量，貼身衣物一經拆封或試穿恕不接受退換。',
        },
        {
          q: '退款要多久？',
          a: '我們收到退回商品並確認無誤後 3–7 個工作天完成退款。信用卡退刷依各發卡行作業時間，通常為 1–2 個帳單週期。',
        },
      ],
    },
  ]

  // FAQ 結構化資料，讓搜尋結果可以直接展開問答
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: groups.flatMap((g) =>
      g.items.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.a },
      })),
    ),
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-xs tracking-[0.3em] text-taupe-600 uppercase">FAQ</p>
        <h1 className="mt-4 text-3xl">常見問題</h1>

        {groups.map((group) => (
          <section key={group.title} className="mt-14">
            <h2 className="text-lg tracking-[0.12em]">{group.title}</h2>
            <dl className="mt-6 divide-y divide-cream-200 border-y border-cream-200">
              {group.items.map((item) => (
                <div key={item.q} className="py-6">
                  <dt className="text-sm text-ink-900">{item.q}</dt>
                  <dd className="mt-2.5 text-sm leading-loose text-ink-700">{item.a}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </>
  )
}
