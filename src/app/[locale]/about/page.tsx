import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { env } from '@/lib/env'
import { listBrands } from '@/lib/catalog/queries'
import { Link } from '@/i18n/routing'

export const revalidate = 3600

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'nav' })
  return { title: t('about'), alternates: { canonical: '/about' } }
}

export default async function AboutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const brands = await listBrands()

  return (
    <article className="mx-auto max-w-3xl px-6 py-16">
      <p className="text-xs tracking-[0.3em] text-taupe-600 uppercase">About</p>
      <h1 className="mt-4 text-3xl leading-relaxed">關於{env.SHOP_NAME}</h1>

      <div className="mt-10 space-y-6 text-sm leading-loose text-ink-700">
        <p>
          {env.SHOP_NAME}創立於 2023 年春天，專注引進韓國高品質睡衣、寢具與家居飾品。
          我們相信，一天當中最放鬆的時刻不該將就 ——
          睡衣不只是睡覺時穿的衣服，而是回到家、卸下一整天之後，最貼近身體的那一層溫柔。
        </p>
        <p>
          選品上我們堅持「經典、優雅、質感」三者並重。
          每一個引進的品牌，都由我們親自試穿、確認材質與版型後才上架，
          並與品牌總部正式授權合作，確保您收到的是正品。
        </p>
        <blockquote className="border-l-2 border-taupe-400 py-1 pl-5 text-base italic text-ink-900">
          讓自己幸福，是他唯一的道德觀。
        </blockquote>
      </div>

      <section className="mt-16">
        <h2 className="text-xl tracking-[0.12em]">合作品牌</h2>
        <ul className="mt-6 divide-y divide-cream-200 border-y border-cream-200">
          {brands.map((brand) => (
            <li key={brand.slug}>
              <Link
                href={`/product/all?brand=${brand.slug}`}
                className="flex items-center justify-between gap-6 py-4 transition-colors hover:text-taupe-600"
              >
                <div>
                  <p className="text-sm tracking-[0.1em] text-ink-900">{brand.name}</p>
                  {brand.description && (
                    <p className="mt-1 text-xs text-taupe-500">{brand.description}</p>
                  )}
                </div>
                <span className="shrink-0 text-xs text-taupe-400">
                  {brand._count.products} 件
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-16 bg-cream-100 p-8">
        <h2 className="text-base tracking-[0.12em]">商店資訊</h2>
        <dl className="mt-5 space-y-2 text-sm text-ink-700">
          <div>
            <dt className="inline text-taupe-600">商號：</dt>
            <dd className="inline">{env.SHOP_NAME}</dd>
          </div>
          <div>
            <dt className="inline text-taupe-600">統一編號：</dt>
            <dd className="inline">{env.SHOP_TAX_ID}</dd>
          </div>
          <div>
            <dt className="inline text-taupe-600">客服信箱：</dt>
            <dd className="inline">service@sagon.local</dd>
          </div>
          <div>
            <dt className="inline text-taupe-600">客服時間：</dt>
            <dd className="inline">週一至週五 10:00–18:00（例假日不出貨）</dd>
          </div>
        </dl>
      </section>
    </article>
  )
}
