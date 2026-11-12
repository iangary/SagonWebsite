'use client'

import { useEffect, useId, useRef, useState, type FormEvent, type Ref } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Check, CircleAlert, Loader2, RotateCcw, Ruler } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ProductCard } from '@/components/product/product-card'
import { BODY_LIMITS } from '@/lib/recommend/limits'
import type { Dimension, DimensionCheck } from '@/lib/recommend/fit'
import type { RecommendationItem, RecommendResult } from '@/lib/recommend/types'
import { cn } from '@/lib/utils'

/**
 * 首頁「尺寸推薦」：顧客填身高、體重（胸圍選填），POST /api/recommend 依適穿對照表
 * 回有現貨的商品與建議尺寸。全符合的在前，部分符合的在後並註明哪一項不符。
 *
 * 對照表還沒有資料時首頁根本不會掛這個元件（見 app/[locale]/page.tsx 的 hasFitData）。
 */

const CLIENT_TIMEOUT_MS = 15_000

type ErrorCode = 'INVALID' | 'RATE_LIMITED' | 'TIMEOUT' | 'FAILED'
const KNOWN_ERRORS: ErrorCode[] = ['INVALID', 'RATE_LIMITED', 'TIMEOUT', 'FAILED']

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; result: RecommendResult; askedBust: boolean }
  | { status: 'error'; code: ErrorCode }

const UNIT: Record<Dimension, string> = { height: 'cm', weight: 'kg', bust: 'cm' }

type Fields = Record<Dimension, string>
type FieldErrors = Partial<Record<Dimension, string>>

export function ProductRecommender({ lineUrl }: { lineUrl: string | null }) {
  const t = useTranslations('home.recommend')
  const locale = useLocale()
  const baseId = useId()
  const [fields, setFields] = useState<Fields>({ height: '', weight: '', bust: '' })
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [state, setState] = useState<State>({ status: 'idle' })
  const inFlight = useRef<AbortController | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  useEffect(() => () => inFlight.current?.abort(), [])

  // 結果出來時把焦點移到結果標題（螢幕閱讀器會念出筆數），手機上順便捲過去
  useEffect(() => {
    if (state.status !== 'done' && state.status !== 'error') return
    const el = resultsRef.current
    if (!el) return
    el.focus({ preventScroll: true })
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [state])

  function validate(): { heightCm: number; weightKg: number; bustCm?: number } | null {
    const errors: FieldErrors = {}
    const values: Partial<Record<Dimension, number>> = {}
    for (const dimension of ['height', 'weight', 'bust'] as const) {
      const raw = fields[dimension].trim()
      const label = t(dimension)
      if (!raw) {
        if (dimension !== 'bust') errors[dimension] = t('fieldRequired', { field: label })
        continue
      }
      const n = Number(raw)
      const { min, max } = BODY_LIMITS[dimension]
      if (!Number.isFinite(n) || n < min || n > max) {
        errors[dimension] = t('fieldRange', { field: label, min, max, unit: UNIT[dimension] })
        continue
      }
      values[dimension] = n
    }
    setFieldErrors(errors)
    if (Object.keys(errors).length) return null
    return { heightCm: values.height!, weightKg: values.weight!, bustCm: values.bust }
  }

  async function run() {
    const body = validate()
    if (!body) return

    inFlight.current?.abort()
    const controller = new AbortController()
    inFlight.current = controller
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, CLIENT_TIMEOUT_MS)

    setState({ status: 'loading' })
    try {
      const res = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      const data = (await res.json().catch(() => null)) as RecommendResult | { code: string } | null
      if (!res.ok || !data || 'code' in data) {
        const code = data && 'code' in data ? data.code : undefined
        setState({
          status: 'error',
          code: KNOWN_ERRORS.includes(code as ErrorCode) ? (code as ErrorCode) : 'FAILED',
        })
        return
      }
      setState({ status: 'done', result: data, askedBust: body.bustCm !== undefined })
    } catch {
      // 被下一次送出取消的不用顯示錯誤；逾時才算
      if (controller.signal.aborted && !timedOut) return
      setState({ status: 'error', code: timedOut ? 'TIMEOUT' : 'FAILED' })
    } finally {
      clearTimeout(timer)
      if (inFlight.current === controller) inFlight.current = null
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void run()
  }

  const loading = state.status === 'loading'

  return (
    <section
      // 首頁 Hero 第一張的按鈕連到這裡；scroll-mt 讓開 sticky header（h-16／lg:h-[4.5rem]）
      id="size-pick"
      aria-labelledby={`${baseId}-title`}
      className="scroll-mt-16 border-b border-cream-200 bg-cream-100/60 lg:scroll-mt-[4.5rem]"
    >
      <div className="mx-auto max-w-7xl px-6 py-14 sm:py-20">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-16">
          <div>
            <p className="flex items-center gap-4">
              <span aria-hidden className="h-px w-8 bg-plum-600" />
              <span className="font-display text-base tracking-[0.12em] text-taupe-600 italic">
                {t('eyebrow')}
              </span>
            </p>
            <h2
              id={`${baseId}-title`}
              className="mt-4 text-2xl leading-snug tracking-[0.08em] text-balance text-ink-900 sm:text-3xl"
            >
              {/* 中文標題只在全形標點後換行，避免「…，幫／您找…」這種斷法（同首頁 Hero 的 BreakableTitle） */}
              {t('title')
                .split(/(?<=[，、。！？])/)
                .map((segment, i) => (
                  <span key={i} className="inline-block">
                    {segment}
                  </span>
                ))}
            </h2>
            <p className="mt-3 text-sm leading-relaxed tracking-wide text-ink-700">{t('description')}</p>
          </div>

          <form onSubmit={onSubmit} noValidate className="min-w-0 self-end">
            <div className="grid grid-cols-3 gap-3">
              {(['height', 'weight', 'bust'] as const).map((dimension) => {
                const id = `${baseId}-${dimension}`
                const error = fieldErrors[dimension]
                return (
                  <div key={dimension} className="min-w-0">
                    <label
                      htmlFor={id}
                      className="mb-1.5 flex flex-wrap items-baseline gap-x-1 text-xs tracking-wide text-ink-700"
                    >
                      {t(dimension)}
                      {dimension === 'bust' && (
                        <span className="text-[11px] text-taupe-500">（{t('optional')}）</span>
                      )}
                    </label>
                    <div
                      className={cn(
                        'flex items-center border bg-white transition-colors focus-within:border-taupe-500',
                        error ? 'border-sale' : 'border-cream-300',
                      )}
                    >
                      <input
                        id={id}
                        type="number"
                        inputMode="decimal"
                        min={BODY_LIMITS[dimension].min}
                        max={BODY_LIMITS[dimension].max}
                        step="0.5"
                        value={fields[dimension]}
                        onChange={(e) => setFields((f) => ({ ...f, [dimension]: e.target.value }))}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={
                          error ? `${id}-error` : dimension === 'bust' ? `${id}-hint` : undefined
                        }
                        enterKeyHint={dimension === 'bust' ? 'search' : 'next'}
                        className="w-full min-w-0 bg-transparent px-3 py-2.5 text-base text-ink-900 [appearance:textfield] focus:outline-none sm:text-sm [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                      <span aria-hidden className="pr-3 text-xs text-taupe-500">
                        {UNIT[dimension]}
                      </span>
                    </div>
                    {error ? (
                      <p id={`${id}-error`} className="mt-1 text-[11px] leading-snug text-sale">
                        {error}
                      </p>
                    ) : (
                      dimension === 'bust' && (
                        <p id={`${id}-hint`} className="mt-1 text-[11px] leading-snug text-taupe-500">
                          {t('bustHint')}
                        </p>
                      )
                    )}
                  </div>
                )
              })}
            </div>

            <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[11px] tracking-wide text-taupe-500">{t('privacy')}</p>
              <Button type="submit" disabled={loading} className="w-full shrink-0 sm:w-auto">
                {loading ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden />
                    {t('submitting')}
                  </>
                ) : (
                  <>
                    <Ruler aria-hidden />
                    {t('submit')}
                  </>
                )}
              </Button>
            </div>
          </form>
        </div>

        <div aria-live="polite" aria-busy={loading}>
          {state.status === 'loading' && <LoadingState label={t('loading')} />}

          {state.status === 'error' && (
            <div ref={resultsRef} tabIndex={-1} className="mt-10 text-center focus:outline-none" role="alert">
              <p className="text-sm text-sale">{t(`errors.${state.code}`)}</p>
              {(state.code === 'TIMEOUT' || state.code === 'FAILED') && (
                <Button variant="outline" size="sm" className="mt-4" onClick={() => void run()}>
                  <RotateCcw aria-hidden />
                  {t('retry')}
                </Button>
              )}
            </div>
          )}

          {state.status === 'done' && state.result.items.length === 0 && (
            <div ref={resultsRef} tabIndex={-1} className="mt-10 text-center focus:outline-none">
              <p className="text-base tracking-wide text-ink-900">{t('emptyTitle')}</p>
              <p className="mt-2 text-sm text-taupe-600">{t('emptyBody')}</p>
              {lineUrl && (
                <Button asChild variant="outline" size="sm" className="mt-5">
                  <a href={lineUrl} target="_blank" rel="noopener noreferrer">
                    {t('lineCta')}
                  </a>
                </Button>
              )}
            </div>
          )}

          {state.status === 'done' && state.result.items.length > 0 && (
            <Results ref={resultsRef} result={state.result} askedBust={state.askedBust} locale={locale} />
          )}
        </div>
      </div>
    </section>
  )
}

function Results({
  ref,
  result,
  askedBust,
  locale,
}: {
  ref: Ref<HTMLDivElement>
  result: RecommendResult
  askedBust: boolean
  locale: string
}) {
  const t = useTranslations('home.recommend')
  const full = result.items.filter((i) => i.match === 'full')
  const partial = result.items.filter((i) => i.match === 'partial')

  return (
    <div className="mt-12">
      <div
        ref={ref}
        tabIndex={-1}
        className="flex flex-col gap-1 border-b border-cream-200 pb-4 focus:outline-none sm:flex-row sm:items-end sm:justify-between"
      >
        <h3 className="text-xl tracking-[0.1em] text-ink-900">
          {t('resultTitle', { count: result.items.length })}
        </h3>
        <p className="text-xs leading-relaxed text-taupe-600">
          {t('resultSummary', { full: full.length, partial: partial.length })}
        </p>
      </div>

      {full.length > 0 && <ItemGrid items={full} askedBust={askedBust} locale={locale} />}

      {partial.length > 0 && (
        <>
          <p
            className={cn(
              'flex items-center gap-2 border-b border-cream-200 pb-3 text-sm tracking-wide text-taupe-600',
              full.length > 0 ? 'mt-12' : 'mt-6',
            )}
          >
            <CircleAlert size={15} aria-hidden />
            {t('partialDivider')}
          </p>
          <ItemGrid items={partial} askedBust={askedBust} locale={locale} offset={full.length} />
        </>
      )}
    </div>
  )
}

function ItemGrid({
  items,
  askedBust,
  locale,
  offset = 0,
}: {
  items: RecommendationItem[]
  askedBust: boolean
  locale: string
  offset?: number
}) {
  return (
    <ul className="mt-8 grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:gap-x-6 xl:grid-cols-6 xl:gap-x-5">
      {items.map((item, i) => (
        <li key={item.product.id} className="fade-up" style={{ animationDelay: `${(i + offset) * 60}ms` }}>
          <ProductCard product={item.product} />
          <FitNote item={item} askedBust={askedBust} locale={locale} />
        </li>
      ))}
    </ul>
  )
}

function FitNote({
  item,
  askedBust,
  locale,
}: {
  item: RecommendationItem
  askedBust: boolean
  locale: string
}) {
  const t = useTranslations('home.recommend')
  const list = new Intl.ListFormat(locale, { type: 'conjunction', style: 'narrow' })

  const sizeText = item.size === 'FREE' ? t('freeSize') : t('sizeLabel', { size: item.size })
  const ok = item.checks.filter((c) => c.status === 'ok').map((c) => t(c.dimension))
  const misses = item.checks.filter((c) => c.status === 'low' || c.status === 'high')
  const noBust =
    askedBust && item.checks.some((c) => c.dimension === 'bust' && c.status === 'unchecked')

  function range(c: DimensionCheck) {
    const unit = UNIT[c.dimension]
    if (c.min !== null && c.max !== null) return t('rangeBoth', { min: c.min, max: c.max, unit })
    if (c.min !== null) return t('rangeMin', { min: c.min, unit })
    return t('rangeMax', { max: c.max ?? 0, unit })
  }

  const full = item.match === 'full'
  return (
    <div className={cn('mt-3 border-l-2 pl-3', full ? 'border-plum-600/60' : 'border-taupe-300')}>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span
          className={cn(
            'inline-flex items-center gap-1 tracking-wide',
            full ? 'text-plum-700' : 'text-taupe-600',
          )}
        >
          {full ? <Check size={12} aria-hidden /> : <CircleAlert size={12} aria-hidden />}
          {full ? t('badgeFull') : t('badgePartial')}
        </span>
        <span className="font-medium text-ink-900">{sizeText}</span>
      </p>
      {item.alsoFits.length > 0 && (
        <p className="mt-1 text-[11px] text-taupe-600">
          {t('alsoFits', { sizes: list.format(item.alsoFits) })}
        </p>
      )}
      <ul className="mt-1.5 space-y-0.5 text-[11px] leading-relaxed text-ink-700 sm:text-xs">
        {ok.length > 0 && <li>{t('allOk', { dims: list.format(ok) })}</li>}
        {misses.map((c) => (
          <li key={c.dimension} className="text-sale">
            {t(c.status === 'low' ? 'low' : 'high', { dim: t(c.dimension), range: range(c) })}
          </li>
        ))}
        {noBust && <li className="text-taupe-500">{t('noBustData')}</li>}
      </ul>
    </div>
  )
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="mt-12">
      <p className="flex items-center gap-2 border-b border-cream-200 pb-4 text-sm tracking-wide text-taupe-600">
        <Loader2 size={16} className="animate-spin" aria-hidden />
        {label}
      </p>
      <ul
        aria-hidden
        className="mt-8 grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:gap-x-6 xl:grid-cols-6 xl:gap-x-5"
      >
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className={cn(i === 2 && 'hidden sm:block', i > 2 && 'hidden xl:block')}>
            <div className="aspect-[3/4] animate-pulse bg-cream-200" />
            <div className="mt-3 h-3 w-1/3 animate-pulse bg-cream-200" />
            <div className="mt-2 h-3.5 w-4/5 animate-pulse bg-cream-200" />
            <div className="mt-2 h-3 w-1/4 animate-pulse bg-cream-200" />
          </li>
        ))}
      </ul>
    </div>
  )
}
