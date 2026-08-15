'use client'

import { useTranslations } from 'next-intl'
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
  const t = useTranslations('orderQuery')

  return (
    <form method="get" className="mt-8 space-y-4">
      <Field label={t('orderNo')} htmlFor="orderNo" required>
        <Input
          id="orderNo"
          name="orderNo"
          defaultValue={defaultOrderNo}
          placeholder={t('orderNoPlaceholder')}
          className="font-mono"
          required
        />
      </Field>

      <Field
        label={t('contact')}
        htmlFor="contact"
        required
        hint={t('contactHint')}
      >
        <Input
          id="contact"
          name="contact"
          defaultValue={defaultContact}
          placeholder={t('contactPlaceholder')}
          required
        />
      </Field>

      <Button type="submit" size="lg">
        <Search size={16} />
        {t('submit')}
      </Button>
    </form>
  )
}
