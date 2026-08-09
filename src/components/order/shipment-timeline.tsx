import { getTranslations } from 'next-intl/server'
import type { LogisticsStatusLog, LogisticsSubType } from '@prisma/client'
import { mapLogisticsStatus, shipmentStatusKey } from '@/lib/ecpay/logistics'
import { cn } from '@/lib/utils'

/**
 * 物流進度時間軸。
 *
 * 資料來自綠界每次狀態回拋寫下的 LogisticsStatusLog，由新到舊。
 */
export async function ShipmentTimeline({
  logs,
  subType,
}: {
  logs: LogisticsStatusLog[]
  subType: LogisticsSubType
}) {
  if (logs.length === 0) return null

  const [t, tShipment] = await Promise.all([
    getTranslations('account'),
    getTranslations('shipmentStatus'),
  ])

  return (
    <section className="mt-8 border-t border-cream-200 pt-8">
      <h2 className="text-sm tracking-[0.1em]">{t('shipmentTracking')}</h2>

      <ol className="mt-5">
        {logs.map((log, index) => {
          const mapped = mapLogisticsStatus(log.statusCode)
          // 綠界每個通路的碼表都不一樣，我們只收錄了對消費者有意義的里程碑，
          // 認不得的碼很常見。這時退回顯示綠界原文，總比整筆不顯示好。
          const text = mapped ? tShipment(shipmentStatusKey(mapped, subType)) : log.message
          const isLatest = index === 0

          return (
            <li key={log.id} className="relative flex gap-4 pb-5 last:pb-0">
              {index < logs.length - 1 && (
                <span
                  aria-hidden
                  className="absolute top-3 left-[3px] h-full w-px bg-cream-300"
                />
              )}
              <span
                aria-hidden
                className={cn(
                  'relative mt-1.5 size-[7px] shrink-0 rounded-full',
                  isLatest ? 'bg-ink-900' : 'bg-cream-300',
                )}
              />
              <div className="min-w-0 flex-1">
                <p className={cn('text-sm', isLatest ? 'text-ink-900' : 'text-taupe-600')}>
                  {text}
                </p>
                <p className="mt-0.5 text-xs text-taupe-500 tabular-nums">
                  {log.occurredAt.toLocaleString('zh-TW', { hour12: false })}
                </p>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
