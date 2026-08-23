import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { currentUser } from '@/lib/auth'
import { formatTWD } from '@/lib/utils'
import {
  PageHeader,
  DataTable,
  Td,
  AdminPagination,
  SearchForm,
  FilterChips,
} from '@/components/admin/ui'
import { Badge } from '@/components/ui/badge'
import { MemberRoleButton } from './member-role'

export const dynamic = 'force-dynamic'
export const metadata = { title: '會員' }

const PER_PAGE = 40

const ROLE_FILTERS = [
  { value: '', label: '全部' },
  { value: 'ADMIN', label: '管理員' },
  { value: 'CUSTOMER', label: '一般會員' },
]

export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; role?: string }>
}) {
  const sp = await searchParams
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1)
  const roleFilter = sp.role === 'ADMIN' || sp.role === 'CUSTOMER' ? sp.role : ''

  const where: Prisma.UserWhereInput = {}
  if (roleFilter) where.role = roleFilter
  if (sp.q?.trim()) {
    const q = sp.q.trim()
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { phone: { contains: q } },
    ]
  }

  const [me, users, total, adminCount] = await Promise.all([
    currentUser(),
    db.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        passwordHash: true,
        createdAt: true,
        accounts: { select: { provider: true } },
        orders: {
          where: { status: { notIn: ['CANCELLED', 'PENDING_PAYMENT'] } },
          select: { grandTotal: true },
        },
      },
    }),
    db.user.count({ where }),
    db.user.count({ where: { role: 'ADMIN' } }),
  ])

  function hrefWithRole(value: string) {
    const params = new URLSearchParams()
    if (sp.q?.trim()) params.set('q', sp.q.trim())
    if (value) params.set('role', value)
    const qs = params.toString()
    return qs ? `/admin/members?${qs}` : '/admin/members'
  }

  return (
    <>
      <PageHeader title="會員" description={`共 ${total} 位，其中 ${adminCount} 位是管理員`} />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <FilterChips
          items={ROLE_FILTERS.map((item) => ({ ...item, href: hrefWithRole(item.value) }))}
          active={roleFilter}
        />
        <SearchForm
          defaultValue={sp.q}
          placeholder="搜尋姓名、Email 或手機"
          width="sm:w-72"
          hidden={{ role: roleFilter || undefined }}
        />
      </div>

      {/* 管理員權限沒有邀請流程：對方先自己註冊，再從這張表升上來 */}
      <p className="mb-5 text-xs leading-relaxed text-taupe-600">
        要多一位管理員，請對方先在前台用任一方式註冊（Email、手機或 Google／LINE／Facebook），
        再在這裡按「設為管理員」。管理員能看到所有訂單與會員資料，並且可以改商品、出貨與退款。
      </p>

      <DataTable
        headers={[
          '姓名',
          'Email',
          '手機',
          '登入方式',
          '有效訂單',
          '累積消費',
          '註冊時間',
          '權限',
        ]}
        empty={users.length === 0}
      >
        {users.map((user) => {
          // 三種登入方式可以並存，這裡把實際綁定的都列出來
          const methods = [
            ...user.accounts.map((a) => a.provider),
            user.passwordHash ? '密碼' : null,
            user.phone ? '手機' : null,
          ].filter(Boolean) as string[]

          const spent = user.orders.reduce((sum, o) => sum + o.grandTotal, 0)
          const isAdmin = user.role === 'ADMIN'

          // 兩種擋法對應 lib/auth/roles.ts 的規則，先在畫面上講清楚而不是按下去才報錯
          const blockedReason =
            user.id === me?.id
              ? '（你自己）'
              : isAdmin && adminCount <= 1
                ? '唯一的管理員'
                : undefined

          return (
            <tr key={user.id}>
              <Td>
                {user.name ?? '—'}
                {isAdmin && (
                  <Badge tone="dark" className="ml-2">
                    管理員
                  </Badge>
                )}
              </Td>
              <Td className="text-taupe-600">{user.email ?? '—'}</Td>
              <Td className="tabular-nums text-taupe-600">{user.phone ?? '—'}</Td>
              <Td className="text-xs text-taupe-600">{methods.join('、') || '—'}</Td>
              <Td className="tabular-nums">{user.orders.length}</Td>
              <Td className="tabular-nums">{formatTWD(spent)}</Td>
              <Td className="whitespace-nowrap text-xs text-taupe-500">
                {user.createdAt.toLocaleDateString('zh-TW')}
              </Td>
              <Td>
                <MemberRoleButton
                  userId={user.id}
                  label={user.name ?? user.email ?? user.phone ?? '這位會員'}
                  isAdmin={isAdmin}
                  blockedReason={blockedReason}
                />
              </Td>
            </tr>
          )
        })}
      </DataTable>

      <AdminPagination
        page={page}
        totalPages={Math.max(1, Math.ceil(total / PER_PAGE))}
        basePath="/admin/members"
        searchParams={sp}
      />
    </>
  )
}
