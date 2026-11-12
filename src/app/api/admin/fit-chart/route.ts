import { NextResponse } from 'next/server'
import { currentUser, isDbAdmin } from '@/lib/auth'
import { db } from '@/lib/db'
import { buildExportRows } from '@/lib/fit-chart/plan'
import { buildFitChartXlsx } from '@/lib/fit-chart/xlsx'

export const dynamic = 'force-dynamic'

/**
 * 下載尺寸對照表（.xlsx）：所有上架商品、每個尺寸一列，已有的適穿範圍預先帶好。
 *
 * proxy.ts 只擋 /admin，API 路徑不在它的 matcher 裡，這裡必須自己驗身分
 * （與 /api/admin/labels 相同）。再問一次資料庫，剛被撤權的人 token 還沒過期也下載不到。
 */
export async function GET() {
  const user = await currentUser()
  if (!user || user.role !== 'ADMIN' || !(await isDbAdmin(user.id))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const buffer = await buildFitChartXlsx(await buildExportRows(db))
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei' }).format(new Date()).replaceAll('-', '')

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      // filename 給不認 RFC 5987 的舊瀏覽器（只能 ASCII），filename* 給其他人看中文檔名
      'Content-Disposition': `attachment; filename="fit-chart-${date}.xlsx"; filename*=UTF-8''${encodeURIComponent(`尺寸對照表-${date}.xlsx`)}`,
      'Cache-Control': 'private, no-store',
    },
  })
}
