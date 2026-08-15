import { describe, expect, it } from 'vitest'
import { buildTcatOrder, goodsNameFor, totalQuantityOf, TcatOrderInvalid } from './order'
import type { TcatOrderInput } from './order'

const CONFIG = { productTypeId: '0008', defaultSpec: '0002' as const, specQtyStep: 9999 }
// 2026-08-17 是週一
const MONDAY = new Date('2026-08-17T02:00:00Z')

const BASE: TcatOrderInput = {
  orderNo: 'SGM4K2P9ABCDEF',
  recipientName: '王小明',
  recipientTel: '02-87121298',
  recipientMobile: '0987654321',
  recipientAddress: '台北市中山區南京東路三段 261 號',
  senderZip: '12334L',
  senderName: '莎岡選品店',
  senderTel: '02-87654321',
  senderMobile: '0912345678',
  senderAddress: '台北市重陽路 200 號',
  productName: '亞麻寬版襯衫',
  totalQuantity: 1,
}

describe('buildTcatOrder', () => {
  it('組出規格 2.2.1 要求的完整電文', () => {
    const order = buildTcatOrder(BASE, CONFIG, MONDAY)

    expect(order).toEqual({
      OBTNumber: '', // PrintType=01 由系統配號
      OrderId: 'SGM4K2P9ABCDEF',
      Thermosphere: '0001',
      Spec: '0002',
      ReceiptLocation: '01',
      ReceiptStationNo: '',
      RecipientName: '王小明',
      RecipientTel: '02-87121298',
      RecipientMobile: '0987654321',
      RecipientAddress: '台北市中山區南京東路三段 261 號',
      SenderName: '莎岡選品店',
      SenderTel: '02-87654321',
      SenderMobile: '0912345678',
      SenderZipCode: '12334L',
      SenderAddress: '台北市重陽路 200 號',
      ShipmentDate: '20260817',
      DeliveryDate: '20260818',
      DeliveryTime: '04',
      IsFreight: 'N',
      IsCollection: 'N',
      CollectionAmount: 0,
      IsSwipe: 'N',
      IsMobilePay: 'N',
      IsDeclare: 'N',
      DeclareAmount: 0,
      ProductTypeId: '0008',
      ProductName: '亞麻寬版襯衫',
      Memo: '',
    })
  })

  it('收件人只有市話也可以建單（電話手機擇一）', () => {
    const order = buildTcatOrder({ ...BASE, recipientMobile: '' }, CONFIG, MONDAY)
    expect(order.RecipientTel).toBe('02-87121298')
    expect(order.RecipientMobile).toBe('')
  })

  it('收件人電話與手機都無效時擋下來，不要送出去被 E027 退件', () => {
    expect(() =>
      buildTcatOrder({ ...BASE, recipientTel: null, recipientMobile: '' }, CONFIG, MONDAY),
    ).toThrow(TcatOrderInvalid)

    // 市話格式的號碼填在手機欄也算無效
    expect(() =>
      buildTcatOrder(
        { ...BASE, recipientTel: '', recipientMobile: '0287121298' },
        CONFIG,
        MONDAY,
      ),
    ).toThrow(TcatOrderInvalid)
  })

  it('寄件人設定不完整時給出指向 env 的錯誤訊息', () => {
    expect(() =>
      buildTcatOrder({ ...BASE, senderTel: '', senderMobile: '' }, CONFIG, MONDAY),
    ).toThrow(/ECPAY_SENDER/)
  })

  it('收件地址是空的就擋下來', () => {
    expect(() => buildTcatOrder({ ...BASE, recipientAddress: '   ' }, CONFIG, MONDAY)).toThrow(
      TcatOrderInvalid,
    )
  })

  it('商品名撞到禁用字時會被清掉，不會整筆被退件', () => {
    const order = buildTcatOrder({ ...BASE, productName: '重要文件一批' }, CONFIG, MONDAY)
    expect(order.ProductName).toBe('重要一批')
  })

  it('材積依件數升級', () => {
    const order = buildTcatOrder(
      { ...BASE, totalQuantity: 10 },
      { ...CONFIG, defaultSpec: '0001', specQtyStep: 3 },
      MONDAY,
    )
    expect(order.Spec).toBe('0004')
  })

  it('週六建單時配達日跳過週日', () => {
    const order = buildTcatOrder(BASE, CONFIG, new Date('2026-08-15T02:00:00Z'))
    expect(order.ShipmentDate).toBe('20260815')
    expect(order.DeliveryDate).toBe('20260817')
  })
})

describe('goodsNameFor', () => {
  it('單品用原名', () => {
    expect(goodsNameFor([{ productName: '亞麻襯衫' }])).toBe('亞麻襯衫')
  })

  it('多品項標示件數', () => {
    expect(
      goodsNameFor([{ productName: '亞麻襯衫' }, { productName: '寬褲' }]),
    ).toBe('亞麻襯衫 等 2 項')
  })
})

describe('totalQuantityOf', () => {
  it('加總每一項的數量，不是品項數', () => {
    expect(totalQuantityOf([{ qty: 2 }, { qty: 3 }])).toBe(5)
    expect(totalQuantityOf([])).toBe(0)
  })
})
