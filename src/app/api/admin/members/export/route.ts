import { NextResponse, type NextRequest } from 'next/server'
import { currentUser, isDbAdmin } from '@/lib/auth'
import { db } from '@/lib/db'
import { audit } from '@/lib/audit'
import { MEMBER_SELECT, memberWhere, parseMemberFilter } from '@/lib/admin/members'
import { buildMembersXlsx } from '@/lib/admin/members-xlsx'

export const dynamic = 'force-dynamic'

/**
 * 會員列表匯出（.xlsx）：與 /admin/members 同一組篩選（?q=&role=），不分頁。
 *
 * proxy.ts 只擋 /admin，API 路徑不在它的 matcher 裡，這裡必須自己驗身分
 * （與 /api/admin/fit-chart 相同）。檔案含個資，每次匯出都記在稽核紀錄。
 */
export async function GET(req: NextRequest) {
  const user = await currentUser()
  if (!user || user.role !== 'ADMIN' || !(await isDbAdmin(user.id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const filter = parseMemberFilter({
    q: req.nextUrl.searchParams.get('q'),
    role: req.nextUrl.searchParams.get('role'),
  })
  const users = await db.user.findMany({
    where: memberWhere(filter),
    orderBy: { createdAt: 'desc' },
    select: MEMBER_SELECT,
  })

  await audit({
    userId: user.id,
    action: 'members.export',
    entity: 'User',
    after: { ...filter, count: users.length },
  })

  const buffer = await buildMembersXlsx(users)
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date()).replaceAll('-', '')

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      // filename 給不認 RFC 5987 的舊瀏覽器（只能 ASCII），filename* 給其他人看中文檔名
      'Content-Disposition': `attachment; filename="members-${date}.xlsx"; filename*=UTF-8''${encodeURIComponent(`會員-${date}.xlsx`)}`,
      'Cache-Control': 'private, no-store',
    },
  })
}
