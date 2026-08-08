import { NextResponse } from 'next/server'
import { getCartItemCount } from '@/lib/cart'

export const dynamic = 'force-dynamic'

export async function GET() {
  const count = await getCartItemCount()
  return NextResponse.json({ count }, { headers: { 'Cache-Control': 'no-store' } })
}
