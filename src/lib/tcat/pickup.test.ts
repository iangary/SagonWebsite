import { describe, expect, it } from 'vitest'
import { buildPickupCall, TcatPickupInvalid, type TcatPickupInput } from './pickup'
import { splitTel } from './fields'

const BASE: TcatPickupInput = {
  customerName: '莎岡選品店',
  contactName: '陳冠儀',
  contactGender: '02',
  contactTel: '02-87654321',
  contactMobile: '0912345678',
  contactAddress: '台北市重陽路 200 號',
  quantity: 3,
  isContact: true,
  isTrolley: false,
  memo: '請走側門',
}

describe('splitTel', () => {
  it('把市話拆成區碼／號碼／分機（規格 2.6.1 第 6~8 項）', () => {
    expect(splitTel('02-87654321')).toEqual({ area: '02', number: '87654321', ext: '' })
    expect(splitTel('(02) 8765 4321 #123')).toEqual({ area: '02', number: '87654321', ext: '123' })
    expect(splitTel('02-87654321轉99')).toEqual({ area: '02', number: '87654321', ext: '99' })
    expect(splitTel('0287654321 分機 5')).toEqual({ area: '02', number: '87654321', ext: '5' })
  })

  it('沒有前導 0 的本地號碼不硬拆區碼', () => {
    expect(splitTel('87654321')).toEqual({ area: '', number: '87654321', ext: '' })
  })

  it('三碼區碼會被拆成兩碼 + 七碼，接回去仍是同一個號碼', () => {
    expect(splitTel('037-123456')).toEqual({ area: '03', number: '7123456', ext: '' })
  })

  it('市話欄位被填成手機時整串丟掉，不要拆出「09」這種區碼', () => {
    expect(splitTel('0912345678')).toEqual({ area: '', number: '', ext: '' })
  })

  it('空值與純符號都回空欄位', () => {
    expect(splitTel(null)).toEqual({ area: '', number: '', ext: '' })
    expect(splitTel('---')).toEqual({ area: '', number: '', ext: '' })
  })
})

describe('buildPickupCall', () => {
  it('組出規格 2.6.1 要求的完整電文', () => {
    expect(buildPickupCall(BASE)).toEqual({
      CustomerName: '莎岡選品店',
      ContactName: '陳冠儀',
      ContactGender: '02',
      ContactTelArea: '02',
      ContactTelNumber: '87654321',
      ContactTelExt: '',
      ContactMobile: '0912345678',
      ContactAddress: '台北市重陽路 200 號',
      NormalQuantity: 3,
      // 沒有低溫商品，這兩欄固定 0
      ColdQuantity: 0,
      FreezeQuantity: 0,
      IsContact: 'Y',
      IsTrolley: 'N',
      Memo: '請走側門',
    })
  })

  it('只有手機也可以叫車（電話手機擇一必填）', () => {
    const call = buildPickupCall({ ...BASE, contactTel: '' })

    expect(call.ContactTelArea).toBe('')
    expect(call.ContactTelNumber).toBe('')
    expect(call.ContactMobile).toBe('0912345678')
  })

  it('電話與手機都不成立時擋下來，不要送出去被退', () => {
    expect(() => buildPickupCall({ ...BASE, contactTel: '', contactMobile: '02-1234' })).toThrow(
      TcatPickupInvalid,
    )
  })

  it('件數不是 1 以上的整數就擋下來（司機不會為了 0 件出車）', () => {
    expect(() => buildPickupCall({ ...BASE, quantity: 0 })).toThrow(TcatPickupInvalid)
    expect(() => buildPickupCall({ ...BASE, quantity: -1 })).toThrow(TcatPickupInvalid)
    expect(() => buildPickupCall({ ...BASE, quantity: 1.5 })).toThrow(TcatPickupInvalid)
  })

  it('聯絡人姓名被清成空的、或收貨地址是空的都擋下來', () => {
    expect(() => buildPickupCall({ ...BASE, contactName: '★★' })).toThrow(TcatPickupInvalid)
    expect(() => buildPickupCall({ ...BASE, contactAddress: '   ' })).toThrow(TcatPickupInvalid)
  })

  it('備註截到 100 字（String(100)）', () => {
    const call = buildPickupCall({ ...BASE, memo: '長'.repeat(150) })

    expect([...call.Memo]).toHaveLength(100)
  })
})
