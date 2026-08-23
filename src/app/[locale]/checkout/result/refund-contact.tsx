import { getTranslations } from 'next-intl/server'
import { MessageCircle, Mail } from 'lucide-react'
import { lineSupport, shopConfig } from '@/lib/shop-config'
import { Button } from '@/components/ui/button'

/**
 * 退款與退換貨的入口：一律導到 LINE 客服。
 *
 * 刻意不做線上申請表單。退款要先確認商品狀態、瑕疵照片、退回方式與收款帳戶，
 * 這些用一來一往的對話處理最快；表單只會讓客人填完之後還是得等客服私訊他。
 * 客服在 LINE 上談定之後，到後台的訂單頁開一張退款單（見 /admin/orders/[id]）。
 *
 * 沒設定 SHOP_LINE_URL 時退回顯示客服信箱，不會出現點了沒反應的按鈕。
 */
export async function RefundContact({ orderNo }: { orderNo: string }) {
  const t = await getTranslations('refund')

  return (
    <section className="mt-8 border-t border-cream-200 pt-8">
      <h2 className="text-sm tracking-[0.1em]">{t('contactTitle')}</h2>
      <p className="mt-2 text-xs leading-relaxed text-taupe-600">
        {/* 沒設定 LINE 官方帳號時整段說明也要換成信箱版本，
            否則會出現「請用 LINE 聯繫」配上一顆寄信按鈕 */}
        {lineSupport ? t('contactBody', { orderNo }) : t('contactBodyEmail', { orderNo })}
      </p>

      <div className="mt-4">
        {lineSupport ? (
          <>
            <Button asChild>
              {/* 外部連結用原生 <a>：next-intl 的 Link 會把它當站內路徑加語系前綴 */}
              <a href={lineSupport.url} target="_blank" rel="noopener noreferrer">
                <MessageCircle size={16} />
                {t('lineCta')}
              </a>
            </Button>
            {lineSupport.id && (
              <p className="mt-2 text-xs text-taupe-500">
                {t('lineId', { id: lineSupport.id })}
              </p>
            )}
          </>
        ) : (
          <Button asChild variant="outline">
            <a href={`mailto:${shopConfig.serviceEmail}?subject=${encodeURIComponent(`退款申請 ${orderNo}`)}`}>
              <Mail size={16} />
              {shopConfig.serviceEmail}
            </a>
          </Button>
        )}
      </div>
    </section>
  )
}
