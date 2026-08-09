import { describe, expect, it } from 'vitest'
import {
  MAX_MESSAGE_LENGTH,
  formatCursor,
  parseCursor,
  previewOf,
  sanitizeMessageBody,
} from './cursor'

describe('游標序列化', () => {
  it('往返之後 createdAt 與 id 都不變', () => {
    const cursor = { createdAt: new Date('2026-08-09T12:34:56.789Z'), id: 'ckabc123' }
    const parsed = parseCursor(formatCursor(cursor))

    expect(parsed?.createdAt.toISOString()).toBe(cursor.createdAt.toISOString())
    expect(parsed?.id).toBe(cursor.id)
  })

  it('id 內含 | 時以第一個分隔符切開', () => {
    // cuid 不會有 |，但游標是使用者可控的字串；切錯會讓時間解析失敗、整段歷史重播
    const parsed = parseCursor('2026-08-09T12:34:56.789Z|a|b')
    expect(parsed?.createdAt.toISOString()).toBe('2026-08-09T12:34:56.789Z')
    expect(parsed?.id).toBe('a|b')
  })

  it.each([
    ['空字串', ''],
    ['null', null],
    ['沒有分隔符', '2026-08-09T12:34:56.789Z'],
    ['分隔符在開頭', '|abc'],
    ['分隔符在結尾', '2026-08-09T12:34:56.789Z|'],
    ['時間無法解析', 'not-a-date|abc'],
  ])('%s 視為沒有游標', (_label, raw) => {
    expect(parseCursor(raw)).toBeNull()
  })
})

describe('sanitizeMessageBody', () => {
  it('去掉首尾空白但保留內部換行', () => {
    expect(sanitizeMessageBody('  第一行\n第二行  ')).toBe('第一行\n第二行')
  })

  it('CRLF 收斂成 LF', () => {
    expect(sanitizeMessageBody('a\r\nb')).toBe('a\nb')
  })

  it('移除控制字元但留下 tab', () => {
    const bell = String.fromCharCode(0x07)
    const tab = String.fromCharCode(0x09)
    expect(sanitizeMessageBody(`a${bell}b${tab}c`)).toBe(`ab${tab}c`)
  })

  it.each([
    ['全是空白', '   \n\t  '],
    ['空字串', ''],
    ['非字串', 42],
    ['undefined', undefined],
  ])('%s 回 null', (_label, raw) => {
    expect(sanitizeMessageBody(raw)).toBeNull()
  })

  it('超長內容截到上限', () => {
    const result = sanitizeMessageBody('あ'.repeat(MAX_MESSAGE_LENGTH + 500))
    expect(result).toHaveLength(MAX_MESSAGE_LENGTH)
  })
})

describe('previewOf', () => {
  it('把換行壓成單行', () => {
    expect(previewOf('請問\n這件有 M 號嗎')).toBe('請問 這件有 M 號嗎')
  })

  it('超過 80 字加上刪節號', () => {
    const preview = previewOf('字'.repeat(200))
    expect(preview).toHaveLength(80)
    expect(preview.endsWith('…')).toBe(true)
  })

  it('剛好 80 字不加刪節號', () => {
    const preview = previewOf('字'.repeat(80))
    expect(preview).toHaveLength(80)
    expect(preview.endsWith('…')).toBe(false)
  })
})
