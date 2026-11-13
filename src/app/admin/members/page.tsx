import { Download } from 'lucide-react'
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
import {
  MEMBER_SELECT,
  loginMethods,
  memberFilterQuery,
  memberWhere,
  parseMemberFilter,
  totalSpent,
} from '@/lib/admin/members'
import { MemberRoleButton } from './member-role'
import { PurchaseBlockButton } from './purchase-block'

export const dynamic = 'force-dynamic'
export const metadata = { title: '會員' }

const PER_PAGE = 40

const ROLE_FILTERS = [
  { value: '', label: '全部' },
  { value: 'ADMIN', label: '管理員' },
  { value: 'CUSTOMER', label: '一般會員' },
  { value: 'BLOCKED', label: '已停止購買' },
]

export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; role?: string }>
}) {
  const sp = await searchParams
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1)
  const filter = parseMemberFilter(sp)
  const roleFilter = filter.role
  const where = memberWhere(filter)

  const [me, users, total, adminCount] = await Promise.all([
    currentUser(),
    db.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      select: MEMBER_SELECT,
    }),
    db.user.count({ where }),
    db.user.count({ where: { role: 'ADMIN' } }),
  ])

  const hrefWithRole = (value: string) =>
    `/admin/members${memberFilterQuery(filter, { role: parseMemberFilter({ role: value }).role })}`

  return (
    // data-admin-wide：後台 layout 的 <main> 看到它就放寬到 max-w-[100rem]（欄位多，6xl 塞不下）
    <div data-admin-wide>
      <PageHeader
        title="會員"
        description={`共 ${total} 位，其中 ${adminCount} 位是管理員`}
        action={
          // 匯出與畫面同一組篩選（搜尋、權限），不分頁
          <a
            href={`/api/admin/members/export${memberFilterQuery(filter)}`}
            download
            className="inline-flex h-10 items-center gap-2 border border-ink-900 px-4 text-sm tracking-wide text-ink-900 transition-colors hover:bg-ink-900 hover:text-cream-50"
          >
            <Download size={16} aria-hidden />
            匯出 Excel
          </a>
        }
      />

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
        scroll
        headers={[
          '姓名',
          'Email',
          '手機',
          '登入方式',
          '有效訂單',
          '累積消費',
          '註冊時間',
          '購買服務',
          '權限',
        ]}
        empty={users.length === 0}
      >
        {users.map((user) => {
          const methods = loginMethods(user)
          const spent = totalSpent(user)
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
              <Td className="whitespace-nowrap">
                {user.name ?? '—'}
                {isAdmin && (
                  <Badge tone="dark" className="ml-2">
                    管理員
                  </Badge>
                )}
              </Td>
              <Td className="whitespace-nowrap text-taupe-600">{user.email ?? '—'}</Td>
              <Td className="whitespace-nowrap tabular-nums text-taupe-600">{user.phone ?? '—'}</Td>
              <Td className="whitespace-nowrap text-xs text-taupe-600">{methods.join('、') || '—'}</Td>
              <Td className="tabular-nums">{user.orders.length}</Td>
              <Td className="whitespace-nowrap tabular-nums">{formatTWD(spent)}</Td>
              <Td className="whitespace-nowrap text-xs text-taupe-500">
                {user.createdAt.toLocaleDateString('zh-TW')}
              </Td>
              <Td className="whitespace-nowrap">
                {user.purchaseBlockedAt && (
                  <p className="mb-1.5 max-w-56 whitespace-normal text-xs text-sale">
                    已停止（{user.purchaseBlockedAt.toLocaleDateString('zh-TW')}）
                    {user.purchaseBlockReason && (
                      <span className="block text-taupe-600">{user.purchaseBlockReason}</span>
                    )}
                  </p>
                )}
                {/* 管理員不會被停權 —— 停了也只是擋自己結帳，按鈕只會造成困惑 */}
                {!isAdmin && (
                  <PurchaseBlockButton
                    userId={user.id}
                    label={user.name ?? user.email ?? user.phone ?? '這位會員'}
                    blocked={Boolean(user.purchaseBlockedAt)}
                  />
                )}
              </Td>
              <Td className="whitespace-nowrap">
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
    </div>
  )
}
