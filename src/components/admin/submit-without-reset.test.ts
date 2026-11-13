import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as React from 'react'
import { submitWithoutReset } from './submit-without-reset'

// 單元測試跑在 node（沒有 DOM），FormData(form, submitter) 換成記錄參數的假類別
class FakeFormData {
  constructor(
    public form: unknown,
    public submitter: unknown,
  ) {}
}

afterEach(() => vi.unstubAllGlobals())

describe('submitWithoutReset', () => {
  it('擋下瀏覽器預設送出，並把含 submitter 的 FormData 交給 action', () => {
    vi.stubGlobal('FormData', FakeFormData)
    const form = { tagName: 'FORM' }
    const submitter = { name: 'intent', value: 'save' }
    const preventDefault = vi.fn()
    const action = vi.fn()

    submitWithoutReset(action)({
      preventDefault,
      currentTarget: form,
      nativeEvent: { submitter },
    } as unknown as React.FormEvent<HTMLFormElement>)

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(action).toHaveBeenCalledOnce()
    const formData = action.mock.calls[0][0] as FakeFormData
    expect(formData).toBeInstanceOf(FakeFormData)
    expect(formData.form).toBe(form)
    expect(formData.submitter).toBe(submitter)
  })
})
