import { describe, expect, it } from 'vitest'
import { COLUMNS, formatIssue, normalizeSize, parseDelimited, parseFitRows, parseProductRef } from './sheet'

const HEADER = COLUMNS.map((c) => c.title)

/** 依 COLUMNS 的順序組一列：代號, 名稱, 品牌, 尺寸, 有現貨, 六格範圍, 備註 */
function row(product: string, size: string, ranges: (number | string | null)[] = [], note = ''): string[] {
  const r = Array.from({ length: 6 }, (_, i) => (ranges[i] === null || ranges[i] === undefined ? '' : String(ranges[i])))
  return [product, '某商品', 'ULLALA', size, '有', ...r, note]
}

const parse = (rows: string[][]) => parseFitRows([HEADER, ...rows])

describe('parseDelimited', () => {
  it('BOM、引號內的逗號與換行、跳脫的雙引號、CRLF；空白列保留（列號才對得上 Excel）', () => {
    expect(parseDelimited('﻿a,b\r\n"x,1","say ""hi""\nthere"\r\n\r\nc,d')).toEqual([
      ['a', 'b'],
      ['x,1', 'say "hi"\nthere'],
      [''],
      ['c', 'd'],
    ])
  })

  it('從試算表直接複製的 Tab 分隔', () => {
    expect(parseDelimited('a\tb\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})

describe('normalizeSize', () => {
  it.each([
    ['m', 'M'],
    [' L ', 'L'],
    ['ｘｌ', 'XL'],
    ['2XL', 'XXL'],
    ['', 'FREE'],
    ['F', 'FREE'],
    ['Free Size', 'FREE'],
    ['均碼', 'FREE'],
    ['單一尺寸', 'FREE'],
  ])('%j → %s', (raw, size) => {
    expect(normalizeSize(raw)).toBe(size)
  })
})

describe('parseProductRef', () => {
  it.each([
    ['https://shopee.tw/product/15897506/45453030873', { kind: 'shopee', itemId: '45453030873' }],
    ['https://shopee.tw/BALCONY-睡衣-i.15897506.45453030873?sp_atk=x', { kind: 'shopee', itemId: '45453030873' }],
    ['45453030873', { kind: 'shopee', itemId: '45453030873' }],
    [
      'https://chenkuanyi.com.tw/product/%E7%8F%BE%E8%B2%A8balcony-45453030873',
      { kind: 'slug', slug: '現貨balcony-45453030873' },
    ],
    ['https://chenkuanyi.com.tw/en/product/abc-123/', { kind: 'slug', slug: 'abc-123' }],
    ['現貨balcony-45453030873', { kind: 'slug', slug: '現貨balcony-45453030873' }],
  ])('%s', (raw, ref) => {
    expect(parseProductRef(raw)).toEqual(ref)
  })

  it('認不出的回 null', () => {
    expect(parseProductRef('')).toBeNull()
    expect(parseProductRef('https://shopee.tw/shop/15897506')).toBeNull()
    expect(parseProductRef('https://chenkuanyi.com.tw/about')).toBeNull()
  })
})

describe('parseFitRows', () => {
  it('正常列：數字取整、單位字樣容忍、空白＝不設限；參考欄位（名稱、品牌、有現貨）不影響', () => {
    const { rows, errors } = parse([row('abc', 'm', [150, '163cm', 40.4, 55], '腰圍鬆緊')])
    expect(errors).toEqual([])
    expect(rows).toEqual([
      {
        line: 2,
        ref: { kind: 'slug', slug: 'abc' },
        refText: 'abc',
        size: 'M',
        heightMin: 150,
        heightMax: 163,
        weightMin: 40,
        weightMax: 55,
        bustMin: null,
        bustMax: null,
        note: '腰圍鬆緊',
        empty: false,
      },
    ])
  })

  it('範圍六格全空白：不是錯誤，標成 empty（代表這個尺寸沒有資料）', () => {
    const { rows, errors } = parse([row('abc', 'FREE')])
    expect(errors).toEqual([])
    expect(rows[0]).toMatchObject({ size: 'FREE', empty: true })
  })

  it('錯誤一次列完，標出第幾列、哪一欄、為什麼', () => {
    const { rows, errors } = parse([
      row('', 'M', [150, 160]), // 第 2 列：沒填商品
      row('abc', 'M', [1.6, 1.7]), // 第 3 列：身高用公尺
      row('abc', 'L', [170, 160]), // 第 4 列：上下限顛倒
      row('abc', 'S', [150, 160, 'abc']), // 第 5 列：不是數字
      row('def', 'M', [150, 160]),
      row('def', 'm', [150, 160]), // 第 7 列：同商品同尺寸重複
    ])
    expect(rows.map((r) => r.line)).toEqual([6])
    expect(errors.map(formatIssue)).toEqual([
      '第 2 列「商品代號」欄：商品代號是空的',
      '第 3 列「身高下限(cm)」欄：1.6 不在合理範圍 80～220（單位填錯了嗎？）',
      '第 3 列「身高上限(cm)」欄：1.7 不在合理範圍 80～220（單位填錯了嗎？）',
      '第 4 列「身高下限(cm)」欄：身高下限 170 大於上限 160',
      '第 5 列「體重下限(kg)」欄：「abc」不是數字',
      '第 7 列「尺寸」欄：與第 6 列是同一件商品的同一個尺寸（M）',
    ])
  })

  it('空白列略過，但列號照 Excel 算', () => {
    const { rows } = parse([[''], row('abc', 'M', [150, 160])])
    expect(rows[0].line).toBe(3)
  })

  it('示範列不能直接匯入', () => {
    expect(parse([row('abc', 'M', [150, 160], '【示範】刪掉')]).errors.map(formatIssue)).toEqual([
      '第 2 列：範本的示範資料，請刪掉這一列',
    ])
  })

  it('舊版 CSV 範本的表頭也認得', () => {
    const old = ['商品（網址或代號）', '商品名稱（參考用，不匯入）', '尺寸', '身高下限(cm)', '身高上限(cm)', '體重下限(kg)', '體重上限(kg)', '胸圍下限(cm)', '胸圍上限(cm)', '備註']
    const { rows, errors } = parseFitRows([old, ['45453030873', '', 'L', '158', '170', '52', '65', '', '', '']])
    expect(errors).toEqual([])
    expect(rows[0]).toMatchObject({ ref: { kind: 'shopee', itemId: '45453030873' }, size: 'L', weightMax: 65 })
  })

  it('缺必要欄位時提示用後台下載的檔案', () => {
    expect(formatIssue(parseFitRows([['名稱', '身高下限']]).errors[0])).toMatch(/找不到「商品代號」欄/)
  })

  it('空檔案', () => {
    expect(parseFitRows([]).errors.map(formatIssue)).toEqual(['第 1 列：檔案是空的'])
  })
})
