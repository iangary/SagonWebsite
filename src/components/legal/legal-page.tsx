import type * as React from 'react'
import { env } from '@/lib/env'

/**
 * 政策條款頁的共用版面（隱私權政策、服務條款、退換貨政策）。
 *
 * 條號用中文數字連續編號 —— 這類文件的條文會被互相引用（「詳見第五條」），
 * 編號本身帶有資訊，不是裝飾。
 *
 * 條文內容用有序的 block 陣列表示，段落／條列／定義列的先後順序由撰稿決定：
 *   ['一般段落', { list: [...] }, { terms: [...] }, '結語段落']
 */

const CLAUSE_NUMERALS = [
  '一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
  '十一', '十二', '十三', '十四', '十五',
]

export type LegalBlock =
  /** 純文字段落；需要放連結時傳 JSX */
  | React.ReactNode
  | { list: React.ReactNode[] }
  | { terms: { term: string; description: React.ReactNode }[] }

export type LegalSection = {
  title: string
  blocks: LegalBlock[]
}

function isList(block: LegalBlock): block is { list: React.ReactNode[] } {
  return typeof block === 'object' && block !== null && 'list' in block
}

function isTerms(
  block: LegalBlock,
): block is { terms: { term: string; description: React.ReactNode }[] } {
  return typeof block === 'object' && block !== null && 'terms' in block
}

export function LegalPage({
  eyebrow,
  title,
  intro,
  updatedAt,
  sections,
}: {
  eyebrow: string
  title: string
  intro: React.ReactNode
  /** 最後更新日期，例如 2026-08-15 */
  updatedAt: string
  sections: LegalSection[]
}) {
  return (
    <article className="mx-auto max-w-3xl px-6 py-16">
      <p className="text-xs tracking-[0.3em] text-taupe-600 uppercase">{eyebrow}</p>
      <h1 className="mt-4 text-3xl">{title}</h1>
      <p className="mt-5 text-sm leading-loose text-ink-700">{intro}</p>
      <p className="mt-4 text-xs text-taupe-500">最後更新：{updatedAt}</p>

      <div className="mt-12 space-y-10">
        {sections.map((section, index) => (
          <section key={section.title}>
            <h2 className="text-base tracking-[0.1em] text-ink-900">
              <span className="mr-2 text-taupe-500">
                {CLAUSE_NUMERALS[index] ?? index + 1}、
              </span>
              {section.title}
            </h2>

            <div className="space-y-3">
              {section.blocks.map((block, i) => {
                if (isList(block)) {
                  return (
                    <ul key={i} className="mt-3 space-y-1.5 text-sm leading-loose text-ink-700">
                      {block.list.map((item, j) => (
                        <li key={j} className="flex gap-2.5">
                          <span
                            aria-hidden
                            className="mt-2.5 size-1 shrink-0 rounded-full bg-taupe-400"
                          />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  )
                }

                if (isTerms(block)) {
                  return (
                    <dl
                      key={i}
                      className="mt-3 space-y-3 border-l border-cream-300 pl-5 text-sm leading-loose"
                    >
                      {block.terms.map((row) => (
                        <div key={row.term}>
                          <dt className="text-ink-900">{row.term}</dt>
                          <dd className="text-ink-700">{row.description}</dd>
                        </div>
                      ))}
                    </dl>
                  )
                }

                return (
                  <p key={i} className="mt-3 text-sm leading-loose text-ink-700">
                    {block}
                  </p>
                )
              })}
            </div>
          </section>
        ))}
      </div>

      <section className="mt-14 bg-cream-100 p-6">
        <h2 className="text-sm tracking-[0.1em] text-ink-900">有疑問嗎？</h2>
        <p className="mt-3 text-sm leading-loose text-ink-700">
          本文件若有未盡事宜，或您想行使其中所載的權利，歡迎來信
          <a
            href={`mailto:${env.SHOP_SERVICE_EMAIL}`}
            className="mx-1 text-ink-900 underline underline-offset-4"
          >
            {env.SHOP_SERVICE_EMAIL}
          </a>
          （客服時間 週一至週五 10:00–18:00）。來信請附上訂單編號，能加快處理速度。
        </p>
      </section>
    </article>
  )
}
