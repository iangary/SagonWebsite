import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
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
  return { title: t('privacy'), alternates: { canonical: '/privacy' } }
}

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)

  const sections: LegalSection[] = [
    {
      title: '適用範圍',
      blocks: [
        `本政策說明 ${env.SHOP_NAME}（統一編號 ${env.SHOP_TAX_ID}，以下稱「本站」）於您瀏覽網站、註冊會員、下單購物與使用客服服務時，如何蒐集、處理及利用您的個人資料。`,
        '本政策不適用於本站以外的第三方網站。當您點擊本站的外部連結（例如綠界科技的付款頁面、物流業者的貨態查詢頁）時，該網站如何處理您的資料，由該業者的隱私權政策規範。',
      ],
    },
    {
      title: '蒐集的個人資料類別與目的',
      blocks: [
        '本站基於「商品交易與履約」、「消費者保護」、「客戶管理與服務」、「網路購物及其他電子商務服務」、「資訊與資料庫管理」等特定目的，蒐集下列資料：',
        {
          terms: [
            {
              term: '會員資料',
              description: '姓名、電子信箱、手機號碼。用於帳號識別、登入驗證與訂單通知。',
            },
            {
              term: '訂單與配送資料',
              description:
                '收件人姓名、聯絡電話、宅配地址或超商取貨門市、訂購品項與金額。用於履行買賣契約、安排出貨與後續售後服務。',
            },
            {
              term: '發票與收據資料',
              description: '發票抬頭、統一編號。用於依法開立統一發票與寄送電子收據。',
            },
            {
              term: '付款相關資料',
              description:
                '付款方式、綠界交易編號、虛擬帳號或繳費代碼、繳費期限。本站不儲存您的信用卡卡號與安全碼 —— 付款頁面由綠界科技提供，完整卡號由綠界及發卡機構處理，本站全程不會接觸。',
            },
            {
              term: '技術與使用紀錄',
              description:
                'IP 位址、瀏覽器類型、瀏覽與操作時間。用於系統安全維護、異常排查與服務改善。',
            },
            {
              term: '客服對話紀錄',
              description: '您透過站內客服或電子郵件與我們往來的內容。用於客服品質管理與交易爭議處理。',
            },
          ],
        },
      ],
    },
    {
      title: '利用期間、地區、對象與方式',
      blocks: [
        {
          list: [
            '期間：自蒐集之日起至您請求刪除或本站終止營運之日止。但交易憑證與發票紀錄等依稅法、商業會計法等法令負有保存義務者，依各該法令所定期間保存。',
            '地區：中華民國境內，以及下列協力廠商提供服務所在地。',
            '方式：以電子檔案或書面形式，於前述特定目的必要範圍內利用。',
          ],
        },
        '為完成交易，本站會將必要資料提供給下列協力廠商，且僅限於完成該項服務所必要的範圍：',
        {
          terms: [
            {
              term: '綠界科技股份有限公司',
              description: '線上收款、超商取貨物流建單與電子收據開立。',
            },
            {
              term: '統一速達股份有限公司（黑貓宅急便）',
              description: '宅配配送與貨態查詢。',
            },
            {
              term: '電子郵件與簡訊服務商',
              description: '寄送訂單通知信與手機登入驗證碼。',
            },
          ],
        },
        '除上述情形、經您同意、或依法律規定與司法機關要求外，本站不會將您的個人資料提供給第三方，也不會販售、交換或出租您的個人資料。',
      ],
    },
    {
      title: 'Cookie 與類似技術',
      blocks: [
        '本站使用下列 Cookie 維持基本購物功能，不使用第三方廣告追蹤 Cookie：',
        {
          terms: [
            {
              term: 'sagon_cart（有效期 30 天）',
              description: '記住您在未登入狀態下的購物車內容。',
            },
            {
              term: 'sagon_chat（有效期 90 天）',
              description: '讓客服對話在關閉瀏覽器後仍能延續。',
            },
            {
              term: '登入工作階段 Cookie（有效期 30 天）',
              description: '維持登入狀態，避免每次瀏覽都要重新登入。',
            },
          ],
        },
        '您可於瀏覽器設定中拒絕或刪除 Cookie，但購物車、登入與結帳功能將無法正常運作。',
      ],
    },
    {
      title: '資料安全措施',
      blocks: [
        {
          list: [
            '全站以 HTTPS 加密傳輸，避免資料於傳輸過程中被竊取。',
            '會員密碼以 argon2id 演算法雜湊儲存，本站無從還原您的原始密碼。',
            '付款流程委由綠界科技處理，本站不接觸、不儲存完整信用卡資訊。',
            '後台採權限控管，僅授權人員得存取訂單資料，且重要操作留有稽核紀錄。',
          ],
        },
      ],
    },
    {
      title: '您對個人資料的權利',
      blocks: [
        '依個人資料保護法第 3 條，您就本站保有的您的個人資料，得行使下列權利：',
        {
          list: [
            '查詢或請求閱覽，以及請求製給複製本。',
            '請求補充或更正。',
            '請求停止蒐集、處理或利用。',
            '請求刪除。',
          ],
        },
        {
          terms: [
            {
              term: '自行修改',
              description: '姓名、聯絡方式與收件地址可直接於「會員中心」修改，不需來信。',
            },
            {
              term: '其他權利之行使',
              description: `請來信 ${env.SHOP_SERVICE_EMAIL}。本站於確認您的身分後將於 15 日內回覆；必要時得延長 15 日並先行告知。部分資料若因法令保存義務或履行契約所必要而無法刪除，本站會向您說明原因。`,
            },
          ],
        },
        '您可以自由選擇是否提供個人資料，但若不提供訂購與配送所需的必要資料，本站將無法為您完成訂單。',
      ],
    },
    {
      title: '未成年人',
      blocks: [
        '未滿 18 歲者使用本服務，應由法定代理人閱讀並同意本政策後始得為之；未滿 7 歲者，應由法定代理人代為行使相關權利。',
      ],
    },
    {
      title: '政策修訂',
      blocks: [
        '本站保留隨時修訂本政策的權利。修訂後將於本頁公告並更新「最後更新」日期；如涉及個人資料利用方式的重大變更，本站將另以電子郵件或站內通知告知。',
      ],
    },
  ]

  return (
    <LegalPage
      eyebrow="Privacy"
      title="隱私權政策"
      intro="我們只蒐集完成交易與服務所必要的資料，不會把您的個人資料販售或提供給與交易無關的第三方。以下說明我們蒐集了什麼、為什麼蒐集，以及您可以如何行使自己的權利。"
      updatedAt="2026-08-15"
      sections={sections}
    />
  )
}
