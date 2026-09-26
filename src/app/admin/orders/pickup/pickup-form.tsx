'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { PhoneCall, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input, Textarea } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { DataTable, Td } from '@/components/admin/ui'
import { adminCallTcatPickup } from '../actions'

export interface PickupParcel {
  id: string
  orderId: string
  orderNo: string
  shipmentNo: string
  receiverName: string
  receiverAddress: string
  hasLabel: boolean
  createdAt: string
}

/**
 * 勾選要交寄的訂單後叫車。
 *
 * 預設全選 —— 最常見的情況是「今天包好的全部交出去」。
 * 送出前一定再跳一次確認：按下去司機就真的會出車，而且當天沒有第二次機會。
 */
export function PickupForm({ parcels }: { parcels: PickupParcel[] }) {
  const router = useRouter()
  const { toast } = useToast()
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set(parcels.map((p) => p.id)))
  const [extra, setExtra] = React.useState('0')
  const [memo, setMemo] = React.useState('')
  const [pending, setPending] = React.useState(false)

  const extraParcels = Number.parseInt(extra, 10)
  const extraValid = /^\d+$/.test(extra.trim()) && extraParcels <= 999
  const total = selected.size + (extraValid ? extraParcels : 0)
  const allSelected = parcels.length > 0 && selected.size === parcels.length

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(parcels.map((p) => p.id)))
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!extraValid) {
      toast('其他包裹件數要是 0 以上的整數', 'error')
      return
    }
    if (total < 1) {
      toast('請至少選一張訂單，或填入其他包裹件數', 'error')
      return
    }

    const chosen = parcels.filter((p) => selected.has(p.id))
    const ok = window.confirm(
      `確定要通知黑貓來收 ${total} 件嗎？\n\n` +
        (chosen.length > 0 ? `訂單：${chosen.map((p) => p.orderNo).join('、')}\n` : '') +
        (extraParcels > 0 ? `另有 ${extraParcels} 件不在網站上的包裹\n` : '') +
        '\n• 司機會依當日路線過來，無法指定時段\n' +
        '• 黑貓每個收貨點一天只受理一次，送出後今天不能再叫\n' +
        '• 請先確認包裹都已打包並貼好託運單',
    )
    if (!ok) return

    setPending(true)
    const result = await adminCallTcatPickup({
      shipmentIds: chosen.map((p) => p.id),
      extraParcels,
      memo: memo.trim() || undefined,
    })
    setPending(false)

    if (!result.ok) {
      toast(result.error, 'error')
      router.refresh()
      return
    }
    toast(result.message)
    router.refresh()
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-6">
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm tracking-[0.1em] text-ink-900">
            待交寄的黑貓包裹（{parcels.length} 件）
          </h2>
          {parcels.length > 0 && (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-taupe-600">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                className="size-4 accent-[#2b2724]"
              />
              全選
            </label>
          )}
        </div>

        <DataTable
          headers={['', '訂單編號', '黑貓託運單號', '收件人', '收件地址', '託運單']}
          empty={parcels.length === 0}
        >
          {parcels.map((p) => (
            <tr key={p.id} className="hover:bg-cream-50">
              <Td>
                <input
                  type="checkbox"
                  checked={selected.has(p.id)}
                  onChange={() => toggle(p.id)}
                  aria-label={`選取訂單 ${p.orderNo}`}
                  className="size-4 accent-[#2b2724]"
                />
              </Td>
              <Td>
                <Link
                  href={`/admin/orders/${p.orderId}`}
                  className="tabular-nums text-ink-900 underline underline-offset-4"
                >
                  {p.orderNo}
                </Link>
                <div className="text-xs text-taupe-500">{p.createdAt}</div>
              </Td>
              <Td className="font-mono text-xs">{p.shipmentNo}</Td>
              <Td>{p.receiverName}</Td>
              <Td className="text-xs text-taupe-600">{p.receiverAddress}</Td>
              <Td>
                {p.hasLabel ? (
                  <a
                    href={`/api/admin/labels/${p.orderId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-ink-900 underline underline-offset-4"
                  >
                    <Printer size={12} />
                    列印
                  </a>
                ) : (
                  <span className="text-xs text-sale">網站上沒有 PDF</span>
                )}
              </Td>
            </tr>
          ))}
        </DataTable>
        <p className="mt-2 text-xs text-taupe-500">
          這裡只列出網站建立、還沒被收走、也還沒排入收貨的黑貓單。直接在黑貓系統開的單請填在下面的「其他包裹」。
        </p>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="其他包裹件數"
          htmlFor="pickup-extra"
          hint="不在上面清單裡、但這趟也要交給司機的件數"
        >
          <Input
            id="pickup-extra"
            inputMode="numeric"
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            aria-invalid={!extraValid}
          />
        </Field>
        <Field
          label="給司機的備註"
          htmlFor="pickup-memo"
          hint="選填。託運單號會自動附在後面（黑貓備註上限 100 字，放不下時只列前幾張）"
        >
          <Textarea
            id="pickup-memo"
            value={memo}
            maxLength={100}
            onChange={(e) => setMemo(e.target.value)}
            className="min-h-11"
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-cream-200 pt-4">
        <Button type="submit" disabled={pending || total < 1 || !extraValid}>
          <PhoneCall size={14} />
          通知黑貓來收 {total} 件
        </Button>
        <span className="text-xs text-taupe-500">
          已選 {selected.size} 張訂單{extraValid && extraParcels > 0 ? `，另 ${extraParcels} 件` : ''}
        </span>
      </div>
    </form>
  )
}
