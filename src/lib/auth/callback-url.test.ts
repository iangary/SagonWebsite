import { describe, expect, it } from 'vitest'
import { safeCallbackUrl } from './callback-url'

describe('safeCallbackUrl', () => {
  it('站內路徑原樣放行', () => {
    expect(safeCallbackUrl('/checkout')).toBe('/checkout')
    expect(safeCallbackUrl('/account/orders?tab=1')).toBe('/account/orders?tab=1')
  })

  it('協定相對網址與外部網址一律不收', () => {
    expect(safeCallbackUrl('//evil.example')).toBeUndefined()
    expect(safeCallbackUrl(String.raw`/\evil.example`)).toBeUndefined()
    expect(safeCallbackUrl('https://evil.example')).toBeUndefined()
    expect(safeCallbackUrl('/\t/evil.example')).toBeUndefined()
  })

  it('沒給就是沒給', () => {
    expect(safeCallbackUrl(undefined)).toBeUndefined()
    expect(safeCallbackUrl('')).toBeUndefined()
  })
})
