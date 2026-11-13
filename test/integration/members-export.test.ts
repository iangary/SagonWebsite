import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', async () => (await import('./mocks')).authMockModule())
vi.mock('next/headers', async () => (await import('./mocks')).nextHeadersMockModule())

import { NextRequest } from 'next/server'
import { readSheet } from 'read-excel-file/node'
import { db } from '@/lib/db'
import { GET as exportMembers } from '@/app/api/admin/members/export/route'
import { createTestAdmin, createTestUser } from '../factories'
import { mockAuthUser } from './mocks'
import type { User } from '@prisma/client'

let admin: User

beforeEach(async () => {
  vi.clearAllMocks()
  admin = await createTestAdmin()
  mockAuthUser({ id: admin.id, role: 'ADMIN' })
})

const request = (qs = '') => new NextRequest(`http://localhost/api/admin/members/export${qs}`)

async function download(qs = ''): Promise<string[][]> {
  const res = await exportMembers(request(qs))
  expect(res.status).toBe(200)
  const rows = await readSheet(Buffer.from(await res.arrayBuffer()), 1)
  return rows.map((r) => r.map((c) => (c === null || c === undefined ? '' : c instanceof Date ? c.toISOString() : String(c))))
}

describe('GET /api/admin/members/export', () => {
  it('訪客、一般會員 → 403', async () => {
    mockAuthUser(null)
    expect((await exportMembers(request())).status).toBe(403)
    const customer = await createTestUser()
    mockAuthUser({ id: customer.id, role: 'CUSTOMER' })
    expect((await exportMembers(request())).status).toBe(403)
  })

  it('匯出所有會員（不分頁），手機保留開頭的 0，並記在稽核紀錄', async () => {
    await createTestUser({ phone: '0912345678' })
    await createTestUser()

    const res = await exportMembers(request())
    expect(res.headers.get('Content-Type')).toContain('spreadsheetml')
    expect(res.headers.get('Content-Disposition')).toMatch(/attachment; filename="members-\d{8}\.xlsx"/)

    const [header, ...rows] = await download()
    expect(header.slice(0, 4)).toEqual(['姓名', 'Email', '手機', '權限'])
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r[2])).toContain('0912345678')
    expect(rows.find((r) => r[1] === admin.email)?.[3]).toBe('管理員')

    const log = await db.auditLog.findFirstOrThrow({ where: { action: 'members.export' } })
    expect(log).toMatchObject({ userId: admin.id, entity: 'User' })
  })

  it('套用與頁面相同的篩選（權限、搜尋）', async () => {
    const blocked = await createTestUser({ email: 'blocked-member@test.local' })
    await db.user.update({ where: { id: blocked.id }, data: { purchaseBlockedAt: new Date(), purchaseBlockReason: '惡意棄單' } })
    await createTestUser({ email: 'someone-else@test.local' })

    const blockedRows = (await download('?role=BLOCKED')).slice(1)
    expect(blockedRows.map((r) => r[1])).toEqual(['blocked-member@test.local'])
    expect(blockedRows[0].slice(8)).toEqual(['已停止', expect.any(String), '惡意棄單'])

    expect((await download('?role=ADMIN')).slice(1).map((r) => r[1])).toEqual([admin.email])
    expect((await download('?q=someone-else')).slice(1).map((r) => r[1])).toEqual(['someone-else@test.local'])
  })
})
