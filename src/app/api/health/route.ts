import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** 給 docker healthcheck 與負載平衡器用。DB 連不上就回 503。 */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`
    return NextResponse.json({ status: 'ok', db: 'up' })
  } catch (error) {
    return NextResponse.json(
      { status: 'degraded', db: 'down', error: (error as Error).message },
      { status: 503 },
    )
  }
}
