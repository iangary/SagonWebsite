import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeSize, parseDelimited, parseFitRows, parseProductRef } from './import-fit-chart'

const HEADER =
  '商品（網址或代號）,商品名稱（參考用，不匯入）,尺寸,身高下限(cm),身高上限(cm),體重下限(kg),體重上限(kg),胸圍下限(cm),胸圍上限(cm),備註'

const parse = (lines: string[]) => parseFitRows(parseDelimited([HEADER, ...lines].join('\n')))

describe('parseDelimited', () => {
  it('BOM、引號內的逗號與換行、跳脫的雙引號、CRLF、空白列', () => {
    expect(parseDelimited('﻿a,b\r\n"x,1","say ""hi""\nthere"\r\n\r\n')).toEqual([
      ['a', 'b'],
      ['x,1', 'say "hi"\nthere'],
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
  it('正常列：數字取整、單位字樣容忍、空白＝不設限', () => {
    const { rows, errors } = parse(['abc,某商品,m,150,163cm,40.4,55,,,腰圍鬆緊'])
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
      },
    ])
  })

  it('錯誤一次列完，並標出列號', () => {
    const { rows, errors } = parse([
      ',沒填商品,M,150,160,40,50,,,',
      'abc,,M,1.6,1.7,,,,,', // 身高用公尺
      'abc,,L,170,160,,,,,', // 上下限顛倒
      'abc,,XL,,,,,,,', // 一項範圍都沒填
      'abc,,S,150,160,abc,,,,', // 不是數字
      'def,,M,150,160,,,,,',
      'def,,m,150,160,,,,,', // 同商品同尺寸重複
    ])
    expect(rows).toHaveLength(1)
    expect(errors).toEqual([
      '第 2 列：認不出商品「（空白）」',
      '第 3 列：身高下限 1.6 不在合理範圍 80～220（單位填錯了嗎？）；身高上限 1.7 不在合理範圍 80～220（單位填錯了嗎？）；身高、體重、胸圍至少要填一項範圍',
      '第 4 列：身高下限 170 大於上限 160',
      '第 5 列：身高、體重、胸圍至少要填一項範圍',
      '第 6 列：體重下限「abc」不是數字',
      '第 8 列：與第 7 列是同一件商品的同一個尺寸（M）',
    ])
  })

  it('範本的示範列不能直接匯入', () => {
    const template = readFileSync(
      path.resolve(import.meta.dirname, '../docs/recommend/fit-chart-template.csv'),
      'utf8',
    )
    const { rows, errors } = parseFitRows(parseDelimited(template))
    expect(rows).toEqual([])
    expect(errors).toEqual([
      '第 2 列：範本的示範資料，請刪掉這一列',
      '第 3 列：範本的示範資料，請刪掉這一列',
      '第 4 列：範本的示範資料，請刪掉這一列',
    ])
  })

  it('範本拿掉【示範】標記後每一列都合法（範本本身不能有錯）', () => {
    const template = readFileSync(
      path.resolve(import.meta.dirname, '../docs/recommend/fit-chart-template.csv'),
      'utf8',
    ).replaceAll('【示範】', '')
    const { rows, errors } = parseFitRows(parseDelimited(template))
    expect(errors).toEqual([])
    expect(rows.map((r) => [r.ref, r.size])).toEqual([
      [{ kind: 'shopee', itemId: '45453030873' }, 'M'],
      [{ kind: 'shopee', itemId: '45453030873' }, 'L'],
      [{ kind: 'slug', slug: '現貨lunaluz-蕾絲開扣織紋-睡衣洋裝-純淨白-26s-48058079610' }, 'FREE'],
    ])
  })

  it('缺必要欄位時提示照範本填', () => {
    expect(parseFitRows([['名稱', '身高下限']]).errors[0]).toMatch(/找不到「商品」欄/)
  })
})
