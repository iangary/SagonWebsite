import 'server-only'
import { env } from '@/lib/env'
import { shopConfig, shopName } from '@/lib/shop-config'

/**
 * schema.org 結構化資料的產生器。
 *
 * 集中在這裡而不是散在各頁，是因為 Google 對「頁面上看得到的內容」與
 * 「結構化資料宣告的內容」必須一致這件事查得很嚴 —— 分散寫最容易出現
 * 某一頁改了價格顯示、卻忘了同步 JSON-LD 的情況。
 */

/** 去掉結尾斜線的站台網址。canonical 與 sitemap 都用同一套算法。 */
export function siteUrl(): string {
  return env.APP_URL.replace(/\/$/, '')
}

export function absoluteUrl(path: string): string {
  return new URL(path, `${siteUrl()}/`).toString()
}

/**
 * JSON-LD 內容會被塞進 <script>，字串裡的 `<` 必須跳脫。
 *
 * 商品名稱與描述來自資料庫（部分是從來源站爬進來的），不能假設乾淨；
 * `</script>` 一旦原樣輸出就會提前關閉標籤，變成 XSS。
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}

// ── 運送與退貨：值一律取自 shopConfig 與實際政策頁，不在這裡另外寫死 ──

/**
 * 運送方式與費率。對應 shopConfig.shippingFee 與免運門檻，
 * 改 SHIPPING_FEE_* 或 FREE_SHIPPING_THRESHOLD 這裡會跟著動。
 */
function shippingDetails() {
  const destination = { '@type': 'DefinedRegion', addressCountry: 'TW' }

  const rate = (value: number, label: string) => ({
    '@type': 'OfferShippingDetails',
    name: label,
    shippingRate: { '@type': 'MonetaryAmount', value, currency: 'TWD' },
    shippingDestination: destination,
  })

  return [
    rate(shopConfig.shippingFee.CVS, '超商取貨'),
    rate(shopConfig.shippingFee.HOME, '宅配'),
    {
      '@type': 'OfferShippingDetails',
      name: '滿額免運',
      shippingRate: {
        '@type': 'MonetaryAmount',
        value: 0,
        currency: 'TWD',
        // 滿 freeShippingThreshold 免運（見 lib/orders/pricing.ts）
        eligibleTransactionVolume: {
          '@type': 'PriceSpecification',
          minPrice: shopConfig.freeShippingThreshold,
          priceCurrency: 'TWD',
        },
      },
      shippingDestination: destination,
    },
  ]
}

/**
 * 退貨政策 —— 依《消費者保護法》的 7 天鑑賞期，與 FAQ 的 a_returns 一致。
 *
 * 刻意不填 `returnFees`（退貨運費由誰負擔）：站上目前沒有任何一頁寫明，
 * 而這是會影響消費爭議的實質條款，不能由程式碼猜。確定政策後再補上
 * `FreeReturn` 或 `ReturnShippingFees`，否則寧可少一個欄位。
 */
function returnPolicy() {
  return {
    '@type': 'MerchantReturnPolicy',
    applicableCountry: 'TW',
    returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
    merchantReturnDays: 7,
    returnMethod: 'https://schema.org/ReturnByMail',
  }
}

type ProductForJsonLd = {
  slug: string
  summary: string | null
  images: { url: string }[]
  brand: { name: string } | null
  variants: { sku: string; price: number; available: number }[]
}

/**
 * 商品頁的 Product 結構化資料。
 *
 * offers 用「每個變體一筆 Offer」而不是單一 AggregateOffer —— 這樣每筆
 * 才帶得到自己的 sku 與庫存狀態（Product 本身沒有 sku 欄位，只有變體有）。
 */
export function productJsonLd({
  product,
  name,
  description,
  reviewStats,
}: {
  product: ProductForJsonLd
  name: string
  description: string
  reviewStats: { average: number; total: number }
}) {
  const url = absoluteUrl(`/product/${product.slug}`)
  const shipping = shippingDetails()
  const returns = returnPolicy()

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name,
    description,
    url,
    image: product.images.map((i) => absoluteUrl(i.url)),
    ...(product.brand ? { brand: { '@type': 'Brand', name: product.brand.name } } : {}),

    offers: product.variants.map((v) => ({
      '@type': 'Offer',
      sku: v.sku,
      url,
      priceCurrency: 'TWD',
      price: v.price,
      availability:
        v.available > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
      shippingDetails: shipping,
      hasMerchantReturnPolicy: returns,
    })),

    /*
     * 一則評論都沒有時整段省略。
     * 給 reviewCount: 0 會被判為無效結構化資料，比不給還糟。
     *
     * average / total 必須來自 getProductReviewStats（全部已核准評論），
     * 不能用頁面上那 20 則算 —— 兩邊數字不一致會被當成欺騙性標記。
     */
    ...(reviewStats.total > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: reviewStats.average,
            reviewCount: reviewStats.total,
            bestRating: 5,
            worstRating: 1,
          },
        }
      : {}),
  }
}

/** 麵包屑。items 的順序要跟畫面上那排一致。 */
export function breadcrumbJsonLd(items: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  }
}

/**
 * 全站的品牌身分，在 [locale]/layout.tsx 輸出一次。
 *
 * sameAs 是社群經營回灌品牌搜尋的接點：Google 靠它把粉專、IG、LINE
 * official account 認回同一個實體。沒設定的就不要放空字串進去。
 */
export function siteJsonLd(locale: string) {
  const base = siteUrl()
  const name = shopName(locale)

  const sameAs = [env.SHOP_FACEBOOK_URL, env.SHOP_INSTAGRAM_URL, env.SHOP_LINE_URL].filter(
    (u): u is string => Boolean(u),
  )

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${base}/#organization`,
        name,
        url: base,
        email: shopConfig.serviceEmail,
        taxID: shopConfig.taxId,
        /*
         * 目前刻意沒有 `logo` —— 站上的標誌是純文字，public/ 底下沒有任何
         * 圖檔。指向不存在的 /logo.png 會讓 Google 抓到 404，比不給這個
         * 欄位更糟（知識面板會整個抓不到圖）。等有正式的標誌圖檔
         * （建議 ≥112×112 的 PNG）放進 public/ 之後再補 logo: absoluteUrl('/logo.png')。
         */
        ...(sameAs.length > 0 ? { sameAs } : {}),
      },
      {
        '@type': 'WebSite',
        '@id': `${base}/#website`,
        url: base,
        name,
        publisher: { '@id': `${base}/#organization` },
        inLanguage: locale === 'en' ? 'en' : 'zh-TW',
        potentialAction: {
          '@type': 'SearchAction',
          target: {
            '@type': 'EntryPoint',
            urlTemplate: `${base}/product/all?q={search_term_string}`,
          },
          'query-input': 'required name=search_term_string',
        },
      },
    ],
  }
}
