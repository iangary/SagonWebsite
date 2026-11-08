import { describe, expect, it } from 'vitest'
import {
  categoryKeyOf,
  cleanProductName,
  detectBrand,
  imageBaseName,
  imageFileName,
  parseDescription,
  renderDescription,
  summaryOf,
  type ShopeeImage,
} from './import-shopee'

describe('cleanProductName', () => {
  it.each([
    ['【現貨】SAGAN莎岡選品店｜ULLALA韓國睡衣 Lena 睡衣套裝｜石竹粉色 26F', '【現貨】ULLALA韓國睡衣 Lena 睡衣套裝｜石竹粉色 26F'],
    ['【預購｜LUNALUZ 台灣經銷｜SAGAN莎岡選品店】柔夜之詩睡衣洋裝', '【預購｜LUNALUZ 台灣經銷】柔夜之詩睡衣洋裝'],
    ['⛔完售🔖開立發票｜SAGAN莎岡選品｜韓國 carol｜可圓領 可V領  二種穿法', '⛔完售｜韓國 carol｜可圓領 可V領 二種穿法'],
    ['|80支棉奢華蕾絲睡袍｜SAGAN莎岡選品®開立發票', '80支棉奢華蕾絲睡袍'],
    ['【⛔完售｜｜SAGAN選品】蕾絲上衣', '【⛔完售】蕾絲上衣'],
  ])('%s', (raw, expected) => {
    expect(cleanProductName(raw)).toBe(expected)
  })

  it('全部都是店名時退回原標題，不產生空名稱', () => {
    expect(cleanProductName('SAGAN莎岡選品店')).toBe('SAGAN莎岡選品店')
  })
})

describe('detectBrand', () => {
  it('不分大小寫，並認得舊標題的 MOMM 筆誤', () => {
    expect(detectBrand('預購｜LunaLuz 台灣經銷')).toBe('LUNALUZ')
    expect(detectBrand('MOMM韓國睡衣| 現貨|毛絨條紋拖鞋')).toBe('MMOM')
    expect(detectBrand('現貨｜JO’S LOUNGE ｜睡衣')).toBe("JO'S LOUNGE")
    expect(detectBrand('雙層紗棉方領蕾絲家居服')).toBeNull()
  })
})

describe('圖片檔名', () => {
  it('商品名拿掉出貨狀態，預購轉現貨時檔名不變', () => {
    const name = 'ULLALA韓國睡衣 Lena 睡衣套裝｜石竹粉色 26F'
    expect(imageBaseName(`【現貨】${name}`)).toBe('ullala韓國睡衣-lena-睡衣套裝-石竹粉色-26f')
    expect(imageBaseName(`【預購｜LUNALUZ 台灣經銷】${name}`)).toBe(imageBaseName(`【現貨】${name}`))
    expect(imageBaseName('⛔完售｜韓國 carol｜可圓領')).toBe('韓國-carol-可圓領')
  })

  it('檔名＝商品名-用途-蝦皮 ID 末 8 碼', () => {
    expect(imageFileName('lena-睡衣套裝', '主圖', 'tw-11134207-820li-msi9lb6rmt4y3d')).toBe(
      'lena-睡衣套裝-主圖-6rmt4y3d.webp',
    )
    expect(imageFileName('lena', '26251WPLLN10 / CR', '8062ec88609c8e662e325c182a97998d')).toBe(
      'lena-26251wplln10-cr-2a97998d.webp',
    )
  })

  it('商品名過長時截到 40 字，emoji 拿掉、結尾不留 -', () => {
    expect(imageBaseName(`🌸${'睡'.repeat(39)} 衣衣`)).toBe('睡'.repeat(39))
  })

  it('全是符號時退回 product', () => {
    expect(imageBaseName('【現貨】｜｜')).toBe('product')
  })
})

describe('categoryKeyOf', () => {
  it.each([
    ['Women Clothes/Sleepwear & Pajamas/Pajamas', 'pajamas'],
    ['Women Clothes/Sleepwear & Pajamas/Others', 'pajamas'],
    ['Women Clothes/Sleepwear & Pajamas/Night Dresses', 'nightdresses'],
    ['Women Clothes/Sleepwear & Pajamas/Kimonos & Robes', 'robes'],
    ['Home & Living/Bathrooms/Towels & Bathrobes/Bath Robes', 'robes'],
    ['Men Clothes/Sleepwear', 'men'],
    ['Women Clothes/Dresses', 'womenswear'],
    ['Fashion Accessories/Necklaces', 'accessories'],
    ['Women Shoes/Flat Sandals & Flip Flops/Indoor Slippers', 'home'],
    ['Home & Living/Kitchenware/Aprons & Kitchen Gloves', 'home'],
  ])('%s → %s', (path, key) => {
    expect(categoryKeyOf(path)).toBe(key)
  })
})

describe('description', () => {
  const text = [
    '',
    'https://s-cf-tw.shopeesz.com/file/tw-11134208-820lc-aaa',
    '',
    '設計語言｜Design Language',
    '',
    '方形領口搭配白色蕾絲，',
    '讓上身線條更清楚。',
    '',
    '尺寸｜Size（cm）',
    '肩寬 39 <胸寬> 40',
    'https://s-cf-tw.shopeesz.com/file/tw-11134208-820lc-missing',
  ].join('\n')

  const blocks = parseDescription(text)

  it('獨立一行的蝦皮圖片網址變成圖、中英對照的短標題變成 h3', () => {
    expect(blocks.map((b) => b.type)).toEqual(['img', 'h3', 'p', 'h3', 'p', 'img'])
  })

  it('換成本機圖片；下載失敗的圖直接略過，不留蝦皮外連', () => {
    const local = new Map<string, ShopeeImage>([
      [
        'https://s-cf-tw.shopeesz.com/file/tw-11134208-820lc-aaa',
        { url: '/uploads/shopee/1/tw-11134208-820lc-aaa.webp', width: 800, height: 600 },
      ],
    ])
    const html = renderDescription(blocks, local, '睡衣 "A"')
    expect(html).toContain('<img src="/uploads/shopee/1/tw-11134208-820lc-aaa.webp" alt="睡衣 &quot;A&quot;" width="800" height="600">')
    expect(html).toContain('<p>方形領口搭配白色蕾絲，<br>讓上身線條更清楚。</p>')
    expect(html).toContain('肩寬 39 &lt;胸寬&gt; 40')
    expect(html).not.toContain('shopeesz.com')
  })

  it('摘要取第一段文字', () => {
    expect(summaryOf(blocks)).toBe('方形領口搭配白色蕾絲，讓上身線條更清楚。')
  })
})
