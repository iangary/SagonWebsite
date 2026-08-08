'use client'

import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Field } from '@/components/ui/input'

/**
 * 用 GET 送出，查詢條件會留在網址上，重新整理與分享連結都還在。
 * 訂單編號本身是隨機碼，配上聯絡方式才查得到，放在網址列是可接受的。
 */
export function OrderQueryForm({
  defaultOrderNo,
  defaultContact,
}: {
  defaultOrderNo: string
  defaultContact: string
}) {
  return (
    <form method="get" className="mt-8 space-y-4">
      <Field label="訂單編號" htmlFor="orderNo" required>
        <Input
          id="orderNo"
          name="orderNo"
          defaultValue={defaultOrderNo}
          placeholder="例如 SGMB1X2Y3Z4ABCDEF"
          className="font-mono"
          required
        />
      </Field>

      <Field
        label="手機號碼或電子信箱"
        htmlFor="contact"
        required
        hint="下單時填寫的聯絡方式"
      >
        <Input
          id="contact"
          name="contact"
          defaultValue={defaultContact}
          placeholder="0912345678 或 you@example.com"
          required
        />
      </Field>

      <Button type="submit" size="lg">
        <Search size={16} />
        查詢訂單
      </Button>
    </form>
  )
}
