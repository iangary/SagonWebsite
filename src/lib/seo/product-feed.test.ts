import { describe, expect, it } from 'vitest'
import { buildProductFeed, type FeedProduct } from './product-feed'

const product: FeedProduct = {
  id: 'clx0000000000000000000000',
  slug: 'silk-pajama-set',
  name: '真絲睡衣套組',
  summary: '100% 桑蠶絲，親膚透氣',
  basePrice: 2880,
  images: [{ url: '/uploads/a.jpg' }, { url: '/uploads/b.jpg' }],
  brand: { name: 'SAGAN' },
  variants: [
    {
      sku: 'SP-IVORY-M',
      name: '米白 / M',
      options: { 顏色: '米白', 尺寸: 'M' },
      price: 2880,
      compareAtPrice: null,
      available: 5,
    },
    {
      sku: 'SP-IVORY-L',
      name: '米白 / L',
      options: { 顏色: '米白', 尺寸: 'L' },
      price: 2380,
      compareAtPrice: 2880,
      available: 0,
    },
  ],
}

const feed = () => buildProductFeed([product], '莎岡選品店')

describe('buildProductFeed', () => {
  it('一個變體一筆 item', () => {
    expect(feed().match(/<item>/g)).toHaveLength(2)
  })

  it('同商品的變體共用 item_group_id，各自帶自己的 sku', () => {
    const xml = feed()
    expect(xml.match(/<g:item_group_id>clx0000000000000000000000<\/g:item_group_id>/g)).toHaveLength(2)
    expect(xml).toContain('<g:id>SP-IVORY-M</g:id>')
    expect(xml).toContain('<g:id>SP-IVORY-L</g:id>')
  })

  it('缺貨的變體回 out_of_stock，不跟著有貨的一起報 in_stock', () => {
    const xml = feed()
    expect(xml).toContain('<g:availability>in_stock</g:availability>')
    expect(xml).toContain('<g:availability>out_of_stock</g:availability>')
  })

  it('有原價時 g:price 是原價、g:sale_price 是現售價', () => {
    // 反過來填折扣就顯示不出來
    const xml = feed()
    expect(xml).toContain('<g:price>2880 TWD</g:price>')
    expect(xml).toContain('<g:sale_price>2380 TWD</g:sale_price>')
  })

  it('沒有原價的變體不輸出 sale_price', () => {
    const single = buildProductFeed(
      [{ ...product, variants: [product.variants[0]] }],
      '莎岡選品店',
    )
    expect(single).not.toContain('g:sale_price')
  })

  it('沒有 GTIN 時一定要有 identifier_exists=no', () => {
    // 少了這行 Merchant Center 會以「缺少商品識別碼」整批退件
    expect(feed().match(/<g:identifier_exists>no<\/g:identifier_exists>/g)).toHaveLength(2)
  })

  it('從 options 取出顏色與尺寸', () => {
    const xml = feed()
    expect(xml).toContain('<g:color>米白</g:color>')
    expect(xml).toContain('<g:size>M</g:size>')
  })

  it('圖片是絕對網址，附圖最多 10 張', () => {
    const many = buildProductFeed(
      [{ ...product, images: Array.from({ length: 15 }, (_, i) => ({ url: `/uploads/${i}.jpg` })) }],
      '莎岡選品店',
    )
    expect(many).toContain('<g:image_link>http://localhost:3000/uploads/0.jpg</g:image_link>')
    // 第一張是 g:image_link，其餘上限 10 張
    expect(many.match(/<g:additional_image_link>/g)).toHaveLength(10 * 2)
  })

  it('跳脫 XML 特殊字元', () => {
    const xml = buildProductFeed(
      [{ ...product, name: 'A & B <test>', summary: null }],
      '莎岡選品店',
    )
    expect(xml).toContain('A &amp; B &lt;test&gt;')
    expect(xml).not.toMatch(/<title>[^<]*<test>/)
  })

  it('標題超過 150 字會被截短', () => {
    const xml = buildProductFeed(
      [{ ...product, name: '長'.repeat(200) }],
      '莎岡選品店',
    )
    const title = xml.match(/<title>(.*?)<\/title>/g)!.find((t) => t.includes('長'))!
    expect(title.replace(/<\/?title>/g, '').length).toBeLessThanOrEqual(150)
  })

  it('item_group_id 只含英數 —— slug 有中文，Google 規格不收', () => {
    // 這個站的 slug 長這樣：the-warmth-法式朱依紋圍裙-柔霧粉-2643530
    const xml = buildProductFeed(
      [{ ...product, slug: 'the-warmth-法式朱依紋圍裙-2643530' }],
      '莎岡選品店',
    )
    for (const m of xml.matchAll(/<g:item_group_id>(.*?)<\/g:item_group_id>/g)) {
      expect(m[1]).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })

  it('沒有品牌時不輸出空的 g:brand', () => {
    const xml = buildProductFeed([{ ...product, brand: null }], '莎岡選品店')
    expect(xml).not.toContain('<g:brand>')
  })
})
