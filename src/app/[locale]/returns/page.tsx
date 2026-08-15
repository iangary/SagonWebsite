import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/routing'
import { env } from '@/lib/env'
import { LegalPage, type LegalSection } from '@/components/legal/legal-page'

export const revalidate = 3600

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'nav' })
  return { title: t('returns'), alternates: { canonical: '/returns' } }
}

export default async function ReturnsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  const sections: LegalSection[] = [
    {
      title: '七天鑑賞期',
      blocks: [
        '依消費者保護法第 19 條，您自收受商品之次日起 7 日內，得以退回商品或書面通知的方式解除買賣契約，無須說明理由，也無須負擔任何費用或對價。',
        '請注意，鑑賞期是「猶豫期間」而非「試用期間」。您可以檢視商品外觀與確認品項是否正確，但為維持商品可再販售的狀態，請勿實際使用、清洗或破壞商品本體包裝。',
      ],
    },
    {
      title: '不適用七天鑑賞期的商品',
      blocks: [
        '依行政院訂定之「通訊交易解除權合理例外情事適用準則」，下列情形不適用七天鑑賞期：',
        {
          list: [
            '睡衣、內著等貼身衣物，一經拆封、試穿或拆除吊牌者。此類商品屬個人衛生用品，基於衛生考量與無法再販售，恕不接受退換。',
            '依您要求，以客製化方式製作或特別訂製之商品。',
            '易於腐敗、保存期限較短，或解約時將逾保存期限之商品。',
            '經您拆封之影音商品或電腦軟體。',
            '非以有形媒介提供之數位內容，或一經提供即為完成之線上服務，且經您事先同意始提供者。',
          ],
        },
        '若商品本身有瑕疵、缺件，或本站寄送錯誤，不受本條限制，請依第五條辦理。',
      ],
    },
    {
      title: '退貨商品應保持的狀態',
      blocks: [
        {
          list: [
            '商品全新完整，未經使用、穿著、清洗或改動。',
            '保留原廠包裝、吊牌、標籤、說明書、配件與隨貨贈品。',
            '外層運送包裝為保護之用，拆封時請避免破壞商品本體的包裝盒或包裝袋。',
            '隨貨寄出的紙本統一發票請一併寄回。',
          ],
        },
        '若商品有缺件、毀損、明顯使用痕跡或無法回復原狀，本站得拒絕退貨，或就減損之價值請求折抵。',
      ],
    },
    {
      title: '申請流程',
      blocks: [
        {
          terms: [
            {
              term: '第 1 步　提出申請',
              description: `於鑑賞期內來信 ${env.SHOP_SERVICE_EMAIL}，附上訂單編號、欲退換的商品名稱與原因；如為瑕疵或寄送錯誤，請一併附上商品照片。`,
            },
            {
              term: '第 2 步　等待客服回覆',
              description:
                '客服確認後，會提供退貨方式與收件資訊。請勿自行寄回未經確認的包裹，以免無法核對訂單而延誤處理。',
            },
            {
              term: '第 3 步　寄回商品',
              description: '依客服提供的方式，將商品連同原包裝、配件與紙本發票寄回。',
            },
            {
              term: '第 4 步　驗收與退款',
              description: '本站收到商品並確認狀態無誤後，隨即為您辦理退款。',
            },
          ],
        },
      ],
    },
    {
      title: '瑕疵商品與出貨錯誤',
      blocks: [
        '若您收到的商品有瑕疵、缺件，或與所訂購的品項、尺寸、顏色不符，請於收貨後 7 日內聯繫客服並提供照片。',
        '經確認屬本站責任者，您可選擇換貨或退貨退款，往返運費均由本站負擔。',
      ],
    },
    {
      title: '退款方式與時程',
      blocks: [
        '本站於收到退回商品並確認無誤後 3–7 個工作天內辦理退款。實際入帳時間依付款方式而異：',
        {
          terms: [
            {
              term: '信用卡',
              description:
                '以原卡退刷。本站辦理後，實際退刷時間依發卡銀行作業而定，通常需 1–2 個帳單週期。',
            },
            {
              term: 'ATM 虛擬帳號、超商代碼繳費',
              description:
                '退款至您指定的帳戶，請於申請時提供本人的銀行名稱、分行、戶名與帳號。',
            },
          ],
        },
        {
          list: [
            '訂單已收取的運費，於全數退貨時一併退還。',
            '訂單使用的折扣碼於退貨後不予返還，亦不折換現金。',
            '退貨完成後，本站將依規定收回紙本統一發票或開立折讓單，並作廢原電子收據。',
          ],
        },
      ],
    },
    {
      title: '換貨',
      blocks: [
        {
          list: [
            '同款商品因尺寸或顏色不符需換貨者，以該品項尚有現貨為限；若無現貨，將改以退款方式處理。',
            '非因商品瑕疵之換貨，同一筆訂單以一次為限。',
            '貼身衣物一經拆封、試穿或拆除吊牌，恕不接受換貨。',
          ],
        },
      ],
    },
    {
      title: '運費負擔',
      blocks: [
        '依消費者保護法規定，您於七天鑑賞期內行使解除權時無須負擔費用，退回商品所生之運費由本站負擔，本站會提供退貨方式，請依客服指示辦理。',
        '因商品瑕疵或本站出貨錯誤而退換貨者，往返運費同樣由本站負擔。',
        '若因您提供的地址或聯絡方式有誤、無人收件或拒絕收件而導致包裹退回，重新寄送的運費由您負擔。',
      ],
    },
    {
      title: '超商取貨未取件',
      blocks: [
        {
          list: [
            '超商取貨到店後，系統會以簡訊或電子郵件通知，請於 7 日內完成取件。',
            '逾期未取件的包裹將自動退回本站，該筆訂單依本政策辦理退款。',
            '本站保留對頻繁未取件或惡意下單之帳號，暫停提供服務的權利。',
          ],
        },
      ],
    },
    {
      title: '相關條款',
      blocks: [
        <>
          本政策為{' '}
          <Link href="/terms" className="text-ink-900 underline underline-offset-4">
            服務條款
          </Link>
          之一部分。關於訂單成立、配送與發票的規定，以及個人資料的處理方式（見{' '}
          <Link href="/privacy" className="text-ink-900 underline underline-offset-4">
            隱私權政策
          </Link>
          ），請一併參閱。
        </>,
      ],
    },
  ]

  return (
    <LegalPage
      eyebrow="Returns"
      title="退換貨政策"
      intro="您享有消費者保護法保障的七天鑑賞期。以下說明哪些商品適用、退貨時商品需保持什麼狀態、怎麼申請，以及退款要多久會入帳。"
      updatedAt="2026-08-15"
      sections={sections}
    />
  )
}
