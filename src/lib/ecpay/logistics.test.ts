import { describe, it, expect } from 'vitest'
import {
  buildCreateShipmentParams,
  isC2C,
  mapLogisticsStatus,
  sanitizeGoodsName,
} from './logistics'

describe('mapLogisticsStatus', () => {
  it('300「綠界已收到訂單資料」是建單完成，不是已出貨', () => {
    // 這個碼曾經被錯誤歸到 IN_TRANSIT，導致訂單一建立就被標成已出貨並寄出貨通知
    expect(mapLogisticsStatus('300')).toBe('CREATED')
    expect(mapLogisticsStatus('310')).toBe('CREATED')
  })

  it('出貨與運送中的碼對應到 IN_TRANSIT', () => {
    expect(mapLogisticsStatus('2030')).toBe('IN_TRANSIT')
    expect(mapLogisticsStatus('3006')).toBe('IN_TRANSIT')
  })

  it('到店可取貨對應到 ARRIVED', () => {
    expect(mapLogisticsStatus('2063')).toBe('ARRIVED')
    expect(mapLogisticsStatus('2073')).toBe('ARRIVED')
  })

  it('已取貨對應到 PICKED_UP', () => {
    expect(mapLogisticsStatus('2067')).toBe('PICKED_UP')
    expect(mapLogisticsStatus('3022')).toBe('PICKED_UP')
  })

  it('退貨系列的前綴碼對應到 RETURNED', () => {
    expect(mapLogisticsStatus('2041')).toBe('RETURNED')
    expect(mapLogisticsStatus('3045')).toBe('RETURNED')
    expect(mapLogisticsStatus('2065')).toBe('RETURNED')
  })

  it('認不得的碼回 null，讓呼叫端不要亂改狀態', () => {
    expect(mapLogisticsStatus('9999')).toBeNull()
    expect(mapLogisticsStatus('')).toBeNull()
  })

  it('同一個碼不會同時落在兩個狀態', () => {
    const seen = new Map<string, string>()
    const codes = [
      ['CREATED', ['300', '310', '2001', '3001']],
      ['IN_TRANSIT', ['2030', '2024', '3006', '3024']],
      ['ARRIVED', ['2063', '2073', '3018', '2068']],
      ['PICKED_UP', ['2067', '2070', '3022', '3023']],
      ['RETURNED', ['2065', '2074', '3019', '2069', '3020']],
      ['FAILED', ['2072', '3021']],
    ] as const

    for (const [status, list] of codes) {
      for (const code of list) {
        expect(seen.has(code), `代碼 ${code} 同時出現在 ${seen.get(code)} 與 ${status}`).toBe(false)
        seen.set(code, status)
        expect(mapLogisticsStatus(code)).toBe(status)
      }
    }
  })
})

describe('sanitizeGoodsName', () => {
  it('移除綠界不接受的符號', () => {
    expect(sanitizeGoodsName('ABC^\'`!@#%&*+\\"<>|_[]DEF')).toBe('ABC DEF')
  })

  it('中文與全形字算 2 個字元寬度，不是 1', () => {
    // 上限 50 是顯示寬度，所以中文最多 25 個。
    // 用 String.slice 直接切 50 個中文會送出 100 字元寬度而被綠界退件。
    const long = 'あ'.repeat(80)
    expect(sanitizeGoodsName(long)).toHaveLength(25)
  })

  it('半形字一個算一個寬度', () => {
    expect(sanitizeGoodsName('a'.repeat(80))).toHaveLength(50)
  })

  it('不會從多位元組字中間切斷', () => {
    // 寬度上限落在中文字中間時要整個捨去，切一半會產生亂碼
    expect(sanitizeGoodsName('あ'.repeat(10), 5)).toBe('ああ')
  })

  it('清空後為空字串時回預設值，避免送出空的商品名稱', () => {
    expect(sanitizeGoodsName('###')).toBe('商品')
  })
})

describe('isC2C', () => {
  it('只有店到店的四家超商是 C2C', () => {
    expect(isC2C('UNIMARTC2C')).toBe(true)
    expect(isC2C('FAMIC2C')).toBe(true)
    expect(isC2C('HILIFEC2C')).toBe(true)
    expect(isC2C('OKMARTC2C')).toBe(true)
  })

  it('超商 B2C 與宅配都不是 C2C —— 這兩種都不能送進綠界建單', () => {
    expect(isC2C('UNIMART')).toBe(false)
    expect(isC2C('FAMI')).toBe(false)
    // 宅配走黑貓，不經綠界
    expect(isC2C('TCAT')).toBe(false)
    expect(isC2C('POST')).toBe(false)
  })
})

describe('buildCreateShipmentParams', () => {
  const input = {
    merchantTradeNo: 'SGTEST001L',
    subType: 'UNIMARTC2C',
    goodsAmount: 1200,
    goodsName: '測試商品',
    receiverName: '王小明',
    receiverCellphone: '0912345678',
    receiverStoreId: '991182',
  } as const

  it('LogisticsType 一律是 CVS', () => {
    // 官方規格：超商（含 B2C）的 LogisticsType 都是 CVS，不會是 HOME
    expect(buildCreateShipmentParams(input).LogisticsType).toBe('CVS')
  })

  it('帶上門市代號與簽章，且不送宅配才需要的欄位', () => {
    const params = buildCreateShipmentParams(input)

    expect(params.ReceiverStoreID).toBe('991182')
    expect(params.CheckMacValue).toMatch(/^[0-9A-F]{32}$/) // 物流是 MD5
    expect(params.SenderZipCode).toBeUndefined()
    expect(params.SenderAddress).toBeUndefined()
    expect(params.Temperature).toBeUndefined()
    expect(params.Distance).toBeUndefined()
  })
})
