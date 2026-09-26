import { describe, expect, it } from 'vitest'
import { breadcrumbJsonLd, productJsonLd, serializeJsonLd, siteJsonLd } from './structured-data'

/**
 * 這幾條測試守的是「Google 會不會判我們造假」這件事，不是格式好不好看。
 * 特別是 aggregateRating —— 頁面顯示與結構化資料對不上會失去複合式搜尋結果資格。
 */

const baseProduct = {
  slug: 'silk-pajama-set',
  summary: '100% 桑蠶絲睡衣套組',
  images: [{ url: '/uploads/a.jpg' }, { url: '/uploads/b.jpg' }],
  brand: { name: 'SAGAN' },
  variants: [
    { sku: 'SP-IVORY-M', price: 2880, available: 3 },
    { sku: 'SP-IVORY-L', price: 2880, available: 0 },
  ],
}

function build(reviewStats: { average: number; total: number }) {
  return productJsonLd({
    product: baseProduct,
    name: '真絲睡衣套組',
    description: '100% 桑蠶絲睡衣套組',
    reviewStats,
  })
}

describe('productJsonLd', () => {
  it('每個變體各一筆 Offer，帶自己的 sku 與庫存狀態', () => {
    const ld = build({ average: 0, total: 0 })

    expect(ld.offers).toHaveLength(2)
    expect(ld.offers[0]).toMatchObject({
      '@type': 'Offer',
      sku: 'SP-IVORY-M',
      price: 2880,
      priceCurrency: 'TWD',
      availability: 'https://schema.org/InStock',
    })
    // 第二個變體沒庫存，不能跟著第一個一起報 InStock
    expect(ld.offers[1].availability).toBe('https://schema.org/OutOfStock')
  })

  it('圖片轉成絕對網址', () => {
    const ld = build({ average: 0, total: 0 })
    expect(ld.image).toEqual([
      'http://localhost:3000/uploads/a.jpg',
      'http://localhost:3000/uploads/b.jpg',
    ])
  })

  it('沒有評論時整段省略 aggregateRating', () => {
    // reviewCount: 0 會被 Google 判為無效結構化資料，比不給還糟
    const ld = build({ average: 0, total: 0 })
    expect(ld).not.toHaveProperty('aggregateRating')
  })

  it('有評論時輸出的分數與則數就是傳進來的值', () => {
    // 傳進來的必須是 getProductReviewStats 的結果（全部已核准評論），
    // 不是商品頁上那 20 則算出來的 —— 兩者不一致就是欺騙性標記
    const ld = build({ average: 4.6, total: 53 })
    expect(ld.aggregateRating).toEqual({
      '@type': 'AggregateRating',
      ratingValue: 4.6,
      reviewCount: 53,
      bestRating: 5,
      worstRating: 1,
    })
  })

  it('每筆 Offer 都帶運送與退貨政策', () => {
    const ld = build({ average: 0, total: 0 })
    for (const offer of ld.offers) {
      expect(offer.hasMerchantReturnPolicy).toMatchObject({
        applicableCountry: 'TW',
        merchantReturnDays: 7,
      })
      // 超商、宅配、滿額免運三種
      expect(offer.shippingDetails).toHaveLength(3)
    }
  })

  it('沒有品牌時不輸出空的 brand 欄位', () => {
    const ld = productJsonLd({
      product: { ...baseProduct, brand: null },
      name: '無品牌商品',
      description: '',
      reviewStats: { average: 0, total: 0 },
    })
    expect(ld).not.toHaveProperty('brand')
  })
})

describe('breadcrumbJsonLd', () => {
  it('position 從 1 開始，網址是絕對路徑', () => {
    const ld = breadcrumbJsonLd([
      { name: '首頁', path: '/' },
      { name: '睡衣', path: '/category/pajamas' },
      { name: '真絲睡衣套組', path: '/product/silk-pajama-set' },
    ])

    expect(ld.itemListElement.map((i) => i.position)).toEqual([1, 2, 3])
    expect(ld.itemListElement[2].item).toBe('http://localhost:3000/product/silk-pajama-set')
  })
})

describe('siteJsonLd', () => {
  it('Organization 與 WebSite 靠 @id 互相指向', () => {
    const ld = siteJsonLd('zh-TW')
    const [org, site] = ld['@graph']

    expect(org['@id']).toBe('http://localhost:3000/#organization')
    expect(site.publisher).toEqual({ '@id': org['@id'] })
  })

  it('沒設定社群網址時不輸出空的 sameAs', () => {
    // 測試環境的 SHOP_*_URL 都是空字串，不能變成 sameAs: ['', '', '']
    const ld = siteJsonLd('zh-TW')
    expect(ld['@graph'][0]).not.toHaveProperty('sameAs')
  })

  it('沒有標誌圖檔時不輸出指向 404 的 logo', () => {
    // public/ 底下目前沒有任何圖檔，指向 /logo.png 會讓 Google 抓到 404
    expect(siteJsonLd('zh-TW')['@graph'][0]).not.toHaveProperty('logo')
  })
})

describe('serializeJsonLd', () => {
  it('跳脫 < 避免商品描述提前關閉 script 標籤', () => {
    // 商品資料有一部分是從來源站爬進來的，不能假設乾淨
    const out = serializeJsonLd({ name: '</script><img src=x onerror=alert(1)>' })
    expect(out).not.toContain('</script>')
    expect(out).toContain('\\u003c')
  })
})
