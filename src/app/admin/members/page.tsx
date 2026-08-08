import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { formatTWD } from '@/lib/utils'
import { PageHeader, DataTable, Td, AdminPagination } from '@/components/admin/ui'
import { Badge } from '@/components/ui/badge'

export const dynamic = 'force-dynamic'
export const metadata = { title: '會員' }

const PER_PAGE = 40

export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>
}) {
  const sp = await searchParams
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1)

  const where: Prisma.UserWhereInput = {}
  if (sp.q?.trim()) {
    const q = sp.q.trim()
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { phone: { contains: q } },
    ]
  }

  const [users, total] = await Promise.all([
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
  ])

  return (
    <>
      <PageHeader title="會員" description={`共 ${total} 位`} />

      <form method="get" className="mb-5 flex gap-2">
        <input
          name="q"
          defaultValue={sp.q ?? ''}
          placeholder="搜尋姓名、Email 或手機"
          className="w-72 border border-cream-300 bg-white px-3 py-2 text-sm focus:border-taupe-500 focus:outline-none"
        />
        <button
          type="submit"
          className="border border-ink-900 px-4 py-2 text-sm transition-colors hover:bg-ink-900 hover:text-cream-50"
        >
          搜尋
        </button>
      </form>

      <DataTable
        headers={['姓名', 'Email', '手機', '登入方式', '有效訂單', '累積消費', '註冊時間']}
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

          return (
            <tr key={user.id}>
              <Td>
                {user.name ?? '—'}
                {user.role === 'ADMIN' && (
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
