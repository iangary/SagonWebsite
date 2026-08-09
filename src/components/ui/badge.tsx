import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center whitespace-nowrap px-2 py-0.5 text-xs font-medium tracking-wide',
  {
    variants: {
      tone: {
        neutral: 'bg-cream-200 text-ink-700',
        dark: 'bg-ink-900 text-cream-50',
        sale: 'bg-sale text-white',
        muted: 'border border-cream-300 bg-transparent text-taupe-500',
        success: 'bg-taupe-500 text-white',
        warning: 'bg-rose-accent text-white',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export function Badge({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />
}

/** 訂單狀態對應的顏色，前後台共用一套。 */
export const ORDER_STATUS_TONE: Record<string, VariantProps<typeof badgeVariants>['tone']> = {
  PENDING_PAYMENT: 'warning',
  PAID: 'success',
  PROCESSING: 'neutral',
  SHIPPED: 'dark',
  COMPLETED: 'success',
  CANCELLED: 'muted',
  REFUNDED: 'sale',
}

/**
 * 物流狀態對應的顏色。
 * ARRIVED 用 warning —— 這是唯一需要客戶採取行動的狀態（超商取貨逾期 7 天會退回），
 * 要跟其他純資訊性的狀態拉開差距。
 */
export const SHIPMENT_STATUS_TONE: Record<string, VariantProps<typeof badgeVariants>['tone']> = {
  PENDING: 'muted',
  CREATED: 'neutral',
  IN_TRANSIT: 'dark',
  ARRIVED: 'warning',
  PICKED_UP: 'success',
  RETURNED: 'sale',
  FAILED: 'sale',
}
