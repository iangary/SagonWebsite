import Link from 'next/link'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { cn } from '@/lib/utils'
import { PageHeader, DataTable, Td, AdminPagination } from '@/components/admin/ui'
import { Badge } from '@/components/ui/badge'
import { WebhookRetry, WebhookPayload } from './webhook-actions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Webhook 事件' }

const PER_PAGE = 40

const KIND_LABEL: Record<string, string> = {
  payment_return: '付款結果',
  payment_info: 'ATM/超商取號',
  logistics_reply: '物流狀態',
  logistics_map: '門市選擇',
}

export default async function AdminWebhooksPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; kind?: string; page?: string }>
}) {
  const sp = await searchParams
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1)

  const where: Prisma.WebhookEventWhereInput = {}
  if (sp.state === 'unprocessed') where.processedAt = null
  if (sp.state === 'invalid') where.signatureValid = false
  if (sp.kind) where.kind = sp.kind

  const [events, total, unprocessed] = await Promise.all([
    db.webhookEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
    }),
    db.webhookEvent.count({ where }),
    db.webhookEvent.count({ where: { processedAt: null } }),
  ])

  const filters = [
    { key: 'state', value: '', label: '全部' },
    { key: 'state', value: 'unprocessed', label: `未處理${unprocessed > 0 ? `（${unprocessed}）` : ''}` },
    { key: 'state', value: 'invalid', label: '簽章無效' },
  ]

  return (
    <>
      <PageHeader
        title="Webhook 事件"
        description="綠界所有回拋的原始紀錄。處理失敗的可以在這裡重送。"
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {filters.map((filter) => (
          <Link
            key={filter.value || 'all'}
            href={filter.value ? `/admin/webhooks?state=${filter.value}` : '/admin/webhooks'}
            className={cn(
              'border px-3 py-1.5 text-xs transition-colors',
              (sp.state ?? '') === filter.value
                ? 'border-ink-900 bg-ink-900 text-cream-50'
                : 'border-cream-300 text-ink-700 hover:border-taupe-400',
            )}
          >
            {filter.label}
          </Link>
        ))}
      </div>

      <DataTable
        headers={['類型', '訂單編號', '簽章', '處理狀態', '嘗試', '時間', '']}
        empty={events.length === 0}
      >
        {events.map((event) => (
          <tr key={event.id} className="align-top">
            <Td>{KIND_LABEL[event.kind] ?? event.kind}</Td>
            <Td className="font-mono text-xs">
              {event.merchantTradeNo ? (
                <Link
                  href={`/admin/orders?q=${event.merchantTradeNo}`}
                  className="underline underline-offset-4"
                >
                  {event.merchantTradeNo}
                </Link>
              ) : (
                '—'
              )}
            </Td>
            <Td>
              {event.kind === 'logistics_map' ? (
                <span className="text-xs text-taupe-500">不適用</span>
              ) : (
                <Badge tone={event.signatureValid ? 'success' : 'sale'}>
                  {event.signatureValid ? '有效' : '無效'}
                </Badge>
              )}
            </Td>
            <Td>
              {event.processedAt ? (
                <Badge tone="neutral">已處理</Badge>
              ) : (
                <Badge tone="warning">未處理</Badge>
              )}
              {event.error && (
                <div className="mt-1 max-w-64 truncate text-xs text-sale" title={event.error}>
                  {event.error.split('\n')[0]}
                </div>
              )}
            </Td>
            <Td className="tabular-nums text-taupe-600">{event.attempts}</Td>
            <Td className="whitespace-nowrap text-xs text-taupe-500">
              {event.createdAt.toLocaleString('zh-TW', { hour12: false })}
            </Td>
            <Td>
              <div className="flex gap-1">
                <WebhookPayload payload={JSON.stringify(event.payload, null, 2)} />
                {!event.processedAt && event.signatureValid && (
                  <WebhookRetry eventId={event.id} />
                )}
              </div>
            </Td>
          </tr>
        ))}
      </DataTable>

      <AdminPagination
        page={page}
        totalPages={Math.max(1, Math.ceil(total / PER_PAGE))}
        basePath="/admin/webhooks"
        searchParams={sp}
      />
    </>
  )
}
