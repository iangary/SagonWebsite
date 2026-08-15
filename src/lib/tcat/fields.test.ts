import { describe, expect, it } from 'vitest'
import {
  formatTcatDate,
  isDeliverable,
  mapTcatStatus,
  normalizeMobile,
  normalizeTel,
  parseTcatDateTime,
  sanitizeAddress,
  sanitizeName,
  sanitizeOrderId,
  sanitizeProductName,
  shipmentDates,
  specForOrder,
  takeTcatZip,
} from './fields'

describe('sanitizeName', () => {
  it('保留中文、英數與附錄二允許的符號', () => {
    expect(sanitizeName('王小明')).toBe('王小明')
    expect(sanitizeName('John Doe-2')).toBe('John Doe-2')
    expect(sanitizeName("O'Brien (Sam)")).toBe("O'Brien (Sam)")
  })

  it('濾掉全形符號與表情符號', () => {
    expect(sanitizeName('王小明😀')).toBe('王小明')
    expect(sanitizeName('王　小明')).toBe('王 小明')
  })

  it('截斷到 30 字', () => {
    expect(sanitizeName('王'.repeat(40))).toHaveLength(30)
  })
})

describe('sanitizeProductName', () => {
  it('移除禁用字串', () => {
    expect(sanitizeProductName('重要文件')).toBe('重要')
    expect(sanitizeProductName('發票一批')).toBe('一批')
  })

  it('先吃掉長的禁用字串，不會留下殘骸', () => {
    // 「身分證明文件」若先被短的「文件」切掉，會留下「身分證明」
    expect(sanitizeProductName('身分證明文件')).toBe('商品')
    expect(sanitizeProductName('訴訟文件')).toBe('商品')
  })

  it('移除後拼出新的禁用字也要再掃一次', () => {
    // 去掉「公文」後剩「訂單」，必須再掃一輪
    expect(sanitizeProductName('訂公文單')).toBe('商品')
  })

  it('整串被濾光時回退成「商品」，因為這是必填欄位', () => {
    expect(sanitizeProductName('文件')).toBe('商品')
    expect(sanitizeProductName('😀')).toBe('商品')
  })

  it('截斷到 20 字', () => {
    expect(sanitizeProductName('洋'.repeat(30))).toHaveLength(20)
  })

  it('正常商品名不受影響', () => {
    expect(sanitizeProductName('亞麻寬版襯衫 米白 M')).toBe('亞麻寬版襯衫 米白 M')
  })
})

describe('sanitizeOrderId', () => {
  it('移除 E001 列出的禁用符號與空白', () => {
    expect(sanitizeOrderId('SG ABC/12_34@X|Y\\Z')).toBe('SGABC1234XYZ')
  })

  it('我們自己產的 orderNo 原樣通過', () => {
    expect(sanitizeOrderId('SGM4K2P9ABCDEF')).toBe('SGM4K2P9ABCDEF')
  })

  it('截斷到 35 字', () => {
    expect(sanitizeOrderId('A'.repeat(50))).toHaveLength(35)
  })
})

describe('sanitizeAddress', () => {
  it('壓縮空白並截斷到 120 字', () => {
    expect(sanitizeAddress(' 台北市  中山區南京東路三段 261 號 ')).toBe(
      '台北市 中山區南京東路三段 261 號',
    )
    expect(sanitizeAddress('台'.repeat(200))).toHaveLength(120)
  })
})

describe('normalizeTel', () => {
  it('只留數字與 - # ,', () => {
    expect(normalizeTel('02-87121298')).toBe('02-87121298')
    // 括號與空白被拿掉，但 - 和 # 是允許的符號，要留著
    expect(normalizeTel('(02) 8712-1298 #305')).toBe('028712-1298#305')
  })

  it('空值回空字串（電話與手機擇一必填，由呼叫端判斷）', () => {
    expect(normalizeTel(null)).toBe('')
    expect(normalizeTel('')).toBe('')
  })
})

describe('normalizeMobile', () => {
  it('接受常見寫法', () => {
    expect(normalizeMobile('0987654321')).toBe('0987654321')
    expect(normalizeMobile('+886987654321')).toBe('0987654321')
    expect(normalizeMobile('0987-654-321')).toBe('0987654321')
  })

  it('不是 09 開頭十碼就回空字串，不要送出去被 E001 退件', () => {
    expect(normalizeMobile('0287121298')).toBe('')
    expect(normalizeMobile('098765432')).toBe('')
    expect(normalizeMobile(null)).toBe('')
  })
})

describe('takeTcatZip', () => {
  it('照規格 2.2.1 第 20 項取後六碼', () => {
    // 規格書原文範例
    expect(takeTcatZip('71-802-24-B')).toBe('80224B')
    // 2.1.3 回應範例的郵號，對應 2.2.3 請求範例的 SenderZipCode
    expect(takeTcatZip('15-123-34-L')).toBe('12334L')
  })

  it('不足六碼視為無效', () => {
    expect(takeTcatZip('12-3')).toBeNull()
  })
})

describe('isDeliverable', () => {
  it('X 代表不可配送', () => {
    expect(isDeliverable('X')).toBe(false)
    expect(isDeliverable('')).toBe(false)
    expect(isDeliverable(null)).toBe(false)
    expect(isDeliverable('12334L')).toBe(true)
  })
})

describe('shipmentDates', () => {
  // 用 UTC 建構，函式內部會換算成台北時間
  const at = (iso: string) => new Date(iso)

  it('配達日必須晚於出貨日', () => {
    const { shipmentDate, deliveryDate } = shipmentDates(at('2026-08-17T02:00:00Z')) // 週一
    expect(shipmentDate).toBe('20260817')
    expect(deliveryDate).toBe('20260818')
  })

  it('週六出貨時配達日跳過週日', () => {
    const { shipmentDate, deliveryDate } = shipmentDates(at('2026-08-15T02:00:00Z')) // 週六
    expect(shipmentDate).toBe('20260815')
    expect(deliveryDate).toBe('20260817') // 跳過 8/16 週日
  })

  it('週日下單時出貨日順延到週一', () => {
    const { shipmentDate, deliveryDate } = shipmentDates(at('2026-08-16T02:00:00Z')) // 週日
    expect(shipmentDate).toBe('20260817')
    expect(deliveryDate).toBe('20260818')
  })

  it('出貨日跳過國定假日', () => {
    // 2026-10-10 是週六且為國慶日 → 出貨日順延，且要再跳過 10/11 週日
    const { shipmentDate, deliveryDate } = shipmentDates(at('2026-10-10T02:00:00Z'))
    expect(shipmentDate).toBe('20261012')
    expect(deliveryDate).toBe('20261013')
  })

  it('配達日不超過出貨日 +7 天', () => {
    const { shipmentDate, deliveryDate } = shipmentDates(at('2026-08-17T02:00:00Z'))
    const days =
      (Date.UTC(2026, 7, Number(deliveryDate.slice(6))) -
        Date.UTC(2026, 7, Number(shipmentDate.slice(6)))) /
      86_400_000
    expect(days).toBeGreaterThan(0)
    expect(days).toBeLessThanOrEqual(7)
  })

  it('台北時區跨日：UTC 前一天的深夜算台北的隔天', () => {
    // 2026-08-16T17:00Z = 台北 2026-08-17 01:00（週一）
    expect(formatTcatDate(at('2026-08-16T17:00:00Z'))).toBe('20260817')
  })
})

describe('parseTcatDateTime', () => {
  it('把台北時間的 yyyyMMddHHmmss 轉成正確的 UTC 時刻', () => {
    expect(parseTcatDateTime('20241206120440')?.toISOString()).toBe('2024-12-06T04:04:40.000Z')
  })

  it('格式不對回 null', () => {
    expect(parseTcatDateTime('2024120612')).toBeNull()
    expect(parseTcatDateTime(null)).toBeNull()
  })
})

describe('specForOrder', () => {
  it('門檻是極大值時一律用預設級距', () => {
    expect(specForOrder(1, '0002', 9999)).toBe('0002')
    expect(specForOrder(50, '0002', 9999)).toBe('0002')
  })

  it('每滿一個門檻升一級', () => {
    expect(specForOrder(1, '0001', 3)).toBe('0001')
    expect(specForOrder(3, '0001', 3)).toBe('0001')
    expect(specForOrder(4, '0001', 3)).toBe('0002')
    expect(specForOrder(7, '0001', 3)).toBe('0003')
  })

  it('不超過 150cm', () => {
    expect(specForOrder(999, '0002', 1)).toBe('0004')
  })

  it('低溫時 clamp 在 120cm（E020：低溫不可用 150cm）', () => {
    expect(specForOrder(999, '0002', 1, '0002')).toBe('0003')
    expect(specForOrder(999, '0002', 1, '0003')).toBe('0003')
  })
})

describe('mapTcatStatus', () => {
  it('配送中的各種代碼', () => {
    expect(mapTcatStatus('111')).toBe('IN_TRANSIT')
    expect(mapTcatStatus('151')).toBe('IN_TRANSIT')
    expect(mapTcatStatus('211')).toBe('IN_TRANSIT')
    expect(mapTcatStatus('420')).toBe('IN_TRANSIT')
  })

  it('301 配完 = 已取貨', () => {
    expect(mapTcatStatus('301')).toBe('PICKED_UP')
  })

  it('退貨類', () => {
    expect(mapTcatStatus('161')).toBe('RETURNED')
    expect(mapTcatStatus('309')).toBe('RETURNED')
  })

  it('異常類不動狀態，只留 log', () => {
    expect(mapTcatStatus('183')).toBeNull() // 地址錯誤
    expect(mapTcatStatus('302')).toBeNull() // BASE 列管
  })

  it('未知代碼回 null —— 官方範例的 100 已集貨就不在附錄一的表裡', () => {
    expect(mapTcatStatus('100')).toBeNull()
    expect(mapTcatStatus('999')).toBeNull()
  })
})
