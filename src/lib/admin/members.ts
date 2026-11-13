/**
 * 後台會員列表的查詢條件與每列資料，給 /admin/members 頁面與 Excel 匯出共用 ——
 * 匯出的內容永遠等於畫面上同一組篩選（不分頁）。
 */
import type { Prisma } from '@prisma/client'

export type MemberRoleFilter = '' | 'ADMIN' | 'CUSTOMER' | 'BLOCKED'

export interface MemberFilter {
  q: string
  role: MemberRoleFilter
}

/** 從網址參數讀出篩選；不認得的值當作沒篩 */
export function parseMemberFilter(sp: { q?: string | null; role?: string | null }): MemberFilter {
  const role = sp.role === 'ADMIN' || sp.role === 'CUSTOMER' || sp.role === 'BLOCKED' ? sp.role : ''
  return { q: sp.q?.trim() ?? '', role }
}

export function memberWhere({ q, role }: MemberFilter): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = {}
  // 「已停止購買」跟權限篩選共用同一排 chip，所以也走 role 這個參數
  if (role === 'BLOCKED') where.purchaseBlockedAt = { not: null }
  else if (role) where.role = role
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { phone: { contains: q } },
    ]
  }
  return where
}

/** 保留目前的篩選，產生帶參數的網址（頁面的 chip、匯出按鈕都用） */
export function memberFilterQuery(filter: MemberFilter, override: Partial<MemberFilter> = {}): string {
  const { q, role } = { ...filter, ...override }
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (role) params.set('role', role)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export const MEMBER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  passwordHash: true,
  purchaseBlockedAt: true,
  purchaseBlockReason: true,
  createdAt: true,
  accounts: { select: { provider: true } },
  orders: {
    where: { status: { notIn: ['CANCELLED', 'PENDING_PAYMENT'] } },
    select: { grandTotal: true },
  },
} satisfies Prisma.UserSelect

export type MemberRow = Prisma.UserGetPayload<{ select: typeof MEMBER_SELECT }>

/** 三種登入方式可以並存，把實際綁定的都列出來 */
export function loginMethods(user: Pick<MemberRow, 'accounts' | 'passwordHash' | 'phone'>): string[] {
  return [
    ...user.accounts.map((a) => a.provider),
    user.passwordHash ? '密碼' : null,
    user.phone ? '手機' : null,
  ].filter((m): m is string => Boolean(m))
}

/** 有效訂單（不含已取消、未付款）的金額合計 */
export function totalSpent(user: Pick<MemberRow, 'orders'>): number {
  return user.orders.reduce((sum, o) => sum + o.grandTotal, 0)
}
