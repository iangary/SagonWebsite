import { describe, it, expect } from 'vitest'
import { checkRoleChange } from './roles'

const ME = 'admin_1'

function target(overrides: Partial<{ id: string; role: 'CUSTOMER' | 'ADMIN' }> = {}) {
  return { id: 'user_2', role: 'CUSTOMER' as const, ...overrides }
}

describe('checkRoleChange', () => {
  it('把一般會員設成管理員是允許的', () => {
    expect(
      checkRoleChange({ actorId: ME, target: target(), nextRole: 'ADMIN', adminCount: 1 }),
    ).toEqual({ ok: true })
  })

  it('還有其他管理員時可以移除某一位', () => {
    expect(
      checkRoleChange({
        actorId: ME,
        target: target({ role: 'ADMIN' }),
        nextRole: 'CUSTOMER',
        adminCount: 2,
      }),
    ).toEqual({ ok: true })
  })

  it('重複設定同一個權限沒有意義，直接擋下', () => {
    const verdict = checkRoleChange({
      actorId: ME,
      target: target({ role: 'ADMIN' }),
      nextRole: 'ADMIN',
      adminCount: 2,
    })
    expect(verdict.ok).toBe(false)
  })

  it('不能改自己的權限 —— 自己降自己會把後台鎖起來', () => {
    const verdict = checkRoleChange({
      actorId: ME,
      target: { id: ME, role: 'ADMIN' },
      nextRole: 'CUSTOMER',
      adminCount: 3,
    })
    expect(verdict).toEqual({ ok: false, error: '不能改自己的權限，請由另一位管理員操作' })
  })

  it('不能移除最後一位管理員', () => {
    const verdict = checkRoleChange({
      actorId: ME,
      target: target({ id: 'admin_only', role: 'ADMIN' }),
      nextRole: 'CUSTOMER',
      adminCount: 1,
    })
    expect(verdict).toEqual({ ok: false, error: '至少要保留一位管理員' })
  })
})
