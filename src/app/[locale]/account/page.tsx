import { redirect } from '@/i18n/routing'

export default async function AccountIndex({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  // 會員中心沒有獨立的總覽頁，直接進訂單列表
  redirect({ href: '/account/orders', locale })
}
