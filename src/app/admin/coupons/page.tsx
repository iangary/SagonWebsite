import { db } from '@/lib/db'
import { formatTWD } from '@/lib/utils'
import { PageHeader, DataTable, Td } from '@/components/admin/ui'
import { Badge } from '@/components/ui/badge'
import { CouponForm, CouponToggle } from './coupon-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: '優惠券' }

const TYPE_LABEL = {
  PERCENT: '百分比折扣',
  FIXED: '固定金額',
  FREE_SHIPPING: '免運費',
} as const

export default async function AdminCouponsPage() {
  const coupons = await db.coupon.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { redemptions: true } } },
  })

  return (
    <>
      <PageHeader title="優惠券" description={`共 ${coupons.length} 張`} />

      <CouponForm />

      <div className="mt-8">
        <DataTable
          headers={['折扣碼', '類型', '折抵', '最低消費', '使用次數', '有效期間', '狀態', '']}
          empty={coupons.length === 0}
        >
          {coupons.map((coupon) => (
            <tr key={coupon.id}>
              <Td>
                <span className="font-mono text-ink-900">{coupon.code}</span>
                {coupon.description && (
                  <div className="text-xs text-taupe-500">{coupon.description}</div>
                )}
              </Td>
              <Td className="text-taupe-600">{TYPE_LABEL[coupon.type]}</Td>
              <Td className="tabular-nums">
                {coupon.type === 'PERCENT'
                  ? `${coupon.value}%`
                  : coupon.type === 'FIXED'
                    ? formatTWD(coupon.value)
                    : '—'}
              </Td>
              <Td className="tabular-nums text-taupe-600">
                {coupon.minSubtotal > 0 ? formatTWD(coupon.minSubtotal) : '無'}
              </Td>
              <Td className="tabular-nums">
                {coupon.usedCount}
                {coupon.usageLimit !== null && ` / ${coupon.usageLimit}`}
                <span className="ml-1 text-xs text-taupe-400">
                  （每人 {coupon.perUserLimit} 次）
                </span>
              </Td>
              <Td className="whitespace-nowrap text-xs text-taupe-500">
                {coupon.startsAt ? coupon.startsAt.toLocaleDateString('zh-TW') : '不限'}
                {' – '}
                {coupon.endsAt ? coupon.endsAt.toLocaleDateString('zh-TW') : '不限'}
              </Td>
              <Td>
                <Badge tone={coupon.isActive ? 'success' : 'muted'}>
                  {coupon.isActive ? '啟用中' : '已停用'}
                </Badge>
              </Td>
              <Td>
                <CouponToggle couponId={coupon.id} isActive={coupon.isActive} />
              </Td>
            </tr>
          ))}
        </DataTable>
      </div>
    </>
  )
}
