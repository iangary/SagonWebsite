import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/routing'
import { env } from '@/lib/env'
import { formatTWD } from '@/lib/utils'
import { LegalPage, type LegalSection } from '@/components/legal/legal-page'

export const revalidate = 3600

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'nav' })
  return { title: t('terms'), alternates: { canonical: '/terms' } }
}

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  const sections: LegalSection[] = [
    {
      title: '條款的適用',
      blocks: [
        `本條款是您與 ${env.SHOP_NAME}（統一編號 ${env.SHOP_TAX_ID}，以下稱「本站」）之間的服務約定。當您瀏覽本站、註冊會員或下單購物，即表示您已閱讀並同意本條款。`,
        <>
          本條款應與{' '}
          <Link href="/privacy" className="text-ink-900 underline underline-offset-4">
            隱私權政策
          </Link>
          {' 及 '}
          <Link href="/returns" className="text-ink-900 underline underline-offset-4">
            退換貨政策
          </Link>
          一併閱讀，三者構成完整的服務約定。
        </>,
      ],
    },
    {
      title: '會員帳號',
      blocks: [
        '本站提供電子信箱密碼、Google 帳號、手機簡訊驗證碼三種登入方式。您可自由選擇其中一種或多種綁定至同一組帳號。',
        {
          list: [
            '註冊時請提供正確、最新且完整的資料；資料變更請即時於「會員中心」更新。',
            '帳號與密碼請妥善保管，不得轉讓、出借或與他人共用。',
            '透過您帳號所進行的一切行為，視為您本人的行為。如發現帳號遭盜用，請立即通知本站。',
            '若有提供不實資料、盜用他人身分或違反本條款之情形，本站得暫停或終止該帳號。',
          ],
        },
      ],
    },
    {
      title: '訂單成立與買賣契約',
      blocks: [
        '您於本站送出訂單，屬於向本站提出購買的要約；本站收到金流機構的付款成功通知並確認入帳後，買賣契約始為成立，訂單狀態會轉為「已付款」。',
        '在您完成付款之前，本站僅為您暫時保留庫存：',
        {
          terms: [
            {
              term: '信用卡、超商代碼繳費',
              description: `保留 ${env.STOCK_RESERVATION_MINUTES} 分鐘。`,
            },
            {
              term: 'ATM 虛擬帳號轉帳',
              description:
                '保留 1 天。因綠界的虛擬帳號繳費期限以「日」為單位計算，最短為 1 天，庫存保留期間比照辦理。',
            },
          ],
        },
        '逾期未完成付款的訂單將自動取消並釋放庫存，屆時該商品可能已被其他消費者購買。訂單成立後恕不接受自行修改；如需協助，請於出貨前聯繫客服。',
      ],
    },
    {
      title: '商品資訊與價格',
      blocks: [
        {
          list: [
            '本站商品圖片因拍攝光線與螢幕顯示差異，可能與實品略有色差，實際顏色以收到的商品為準。',
            '商品尺寸為人工測量，可能有些許誤差。',
            '所有價格均以新臺幣計價並含稅。',
            '商品標價、庫存或說明如因系統錯誤或人為疏失而顯有錯誤，本站得於出貨前取消該筆訂單並全額退款，不另負損害賠償責任。',
            '每筆訂單限用一組折扣碼，折扣碼的使用門檻、期限與次數以各該折扣碼的說明為準。',
          ],
        },
      ],
    },
    {
      title: '付款方式',
      blocks: [
        '本站透過綠界科技 ECPay 提供下列付款方式，本站不會接觸您的完整信用卡資訊：',
        {
          list: [
            '信用卡（支援分期）。',
            'ATM 虛擬帳號轉帳，下單後取得繳費帳號。',
            '超商代碼繳費，下單後取得繳費代碼。',
          ],
        },
        '請於繳費期限內完成付款。跨行轉帳如產生手續費，由您自行負擔。',
      ],
    },
    {
      title: '配送與運費',
      blocks: [
        {
          terms: [
            {
              term: '超商取貨',
              description: `運費 ${formatTWD(env.SHIPPING_FEE_CVS)}，支援 7-ELEVEN、全家、萊爾富、OK 超商。`,
            },
            {
              term: '宅配到府',
              description: `運費 ${formatTWD(env.SHIPPING_FEE_HOME)}，由黑貓宅急便配送。`,
            },
            {
              term: '免運門檻',
              description: `單筆訂單消費滿 ${formatTWD(env.FREE_SHIPPING_THRESHOLD)} 免運費。`,
            },
          ],
        },
        {
          list: [
            '本站於確認收到款項後的 1–3 個工作天內出貨（例假日與國定假日順延）。',
            '超商取貨到店後，請於 7 日內完成取件；逾期包裹將退回本站。',
            '配送僅限中華民國臺澎金馬地區。',
            '因您提供的地址或聯絡方式有誤、無人收件或拒絕收件而導致包裹退回，重新寄送所產生的運費由您負擔。',
          ],
        },
      ],
    },
    {
      title: '發票與收據',
      blocks: [
        {
          terms: [
            {
              term: '統一發票',
              description:
                '本站開立紙本統一發票，於出貨時隨包裹一併寄出。需要三聯式發票請於結帳時填寫統一編號與公司抬頭；發票開立後恕不更改抬頭與統編。',
            },
            {
              term: '電子收據',
              description:
                '付款完成後，本站另會寄送一份電子收據至您的信箱，作為付款憑證。電子收據不是統一發票，不可作為報稅或扣抵之憑證。',
            },
          ],
        },
      ],
    },
    {
      title: '退換貨',
      blocks: [
        <>
          退換貨的條件、期限與流程，詳見{' '}
          <Link href="/returns" className="text-ink-900 underline underline-offset-4">
            退換貨政策
          </Link>
          。
        </>,
      ],
    },
    {
      title: '智慧財產權',
      blocks: [
        '本站的網站設計、商標、文案、商品攝影與其他內容，其著作權及相關智慧財產權均屬本站或原權利人所有。未經事前書面同意，不得重製、公開傳輸、改作、散布或作商業使用。',
      ],
    },
    {
      title: '使用規範',
      blocks: [
        '使用本服務時，請勿有下列行為：',
        {
          list: [
            '以自動化程式、機器人或其他非正常方式大量下單、搶購或干擾系統運作。',
            '嘗試未經授權存取本站系統、其他使用者帳號或訂單資料。',
            '冒用他人身分或提供不實資料。',
            '以轉售為目的之大量採購（本站得視情況拒絕或取消訂單）。',
            '惡意下單後不付款、頻繁無故退貨或未取件，影響本站正常營運。',
          ],
        },
        '違反前述規範者，本站得取消訂單、暫停或終止您的帳號，並保留法律追訴權。',
      ],
    },
    {
      title: '服務中斷與免責',
      blocks: [
        '本站將盡力維持服務穩定，但於系統維護、升級，或因天災、電信中斷、駭客攻擊等不可歸責於本站之事由，服務可能暫停或中斷。就此所生之損害，本站於法律允許範圍內不負賠償責任。',
        '本站對已成立訂單之責任，以該筆訂單金額為上限。但因本站故意或重大過失所致者，不在此限。',
      ],
    },
    {
      title: '條款修訂',
      blocks: [
        '本站得隨時修訂本條款，修訂後於本頁公告並更新「最後更新」日期。公告後您繼續使用本服務，視為同意修訂後的條款。已成立的訂單，仍適用下單當時的條款。',
      ],
    },
    {
      title: '準據法與管轄法院',
      blocks: [
        '本條款以中華民國法律為準據法。因本條款或本站服務所生之爭議，雙方同意以臺灣臺北地方法院為第一審管轄法院；但不影響消費者依消費者保護法等法律所享有之權利，以及專屬管轄之規定。',
      ],
    },
  ]

  return (
    <LegalPage
      eyebrow="Terms"
      title="服務條款"
      intro="以下說明在本站購物的權利與義務：訂單什麼時候算成立、庫存保留多久、運費與出貨怎麼計算，以及雙方各自的責任範圍。"
      updatedAt="2026-08-15"
      sections={sections}
    />
  )
}
