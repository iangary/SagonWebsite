import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { NextIntlClientProvider, hasLocale } from 'next-intl'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { SessionProvider } from 'next-auth/react'

import { routing } from '@/i18n/routing'
import { SiteHeader } from '@/components/layout/site-header'
import { SiteFooter } from '@/components/layout/site-footer'
import { ToastProvider } from '@/components/ui/toast'
import { CartCountProvider } from '@/components/cart/cart-count-provider'
import '@/styles/globals.css'

/**
 * 刻意不提供 generateStaticParams。
 *
 * 每一頁都含有 SiteHeader，而 header 的分類導覽需要查資料庫；
 * 容器建置階段沒有資料庫，硬要在建置時預渲染只會失敗，就算改成
 * 容錯回空陣列，也會把「沒有分類」的 HTML 烤進去，之後靠 ISR 才慢慢修正。
 *
 * 拿掉之後，頁面改成第一次被請求時才產生，並依各頁的 revalidate 快取，
 * 內容從第一位訪客開始就是正確的。
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'home' })

  const title = process.env.SHOP_NAME ?? '莎岡選品店'
  return {
    metadataBase: new URL(process.env.APP_URL ?? 'http://localhost:3000'),
    title: { default: title, template: `%s｜${title}` },
    description: t('heroSubtitle'),
    openGraph: {
      type: 'website',
      siteName: title,
      title,
      description: t('heroSubtitle'),
      locale: locale === 'en' ? 'en_US' : 'zh_TW',
    },
    alternates: {
      canonical: '/',
      languages: { 'zh-Hant': '/', en: '/en' },
    },
  }
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) notFound()

  // 讓靜態渲染的頁面也能拿到正確語系
  setRequestLocale(locale)

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <NextIntlClientProvider>
          <SessionProvider>
            <ToastProvider>
              <CartCountProvider>
                <SiteHeader />
                <main className="flex-1">{children}</main>
                <SiteFooter />
              </CartCountProvider>
            </ToastProvider>
          </SessionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
