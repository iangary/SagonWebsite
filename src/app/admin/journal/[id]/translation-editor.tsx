'use client'

import * as React from 'react'
import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Textarea, Field } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { savePostTranslation, type PostFormState } from '../actions'
import { submitWithoutReset } from '@/components/admin/submit-without-reset'
import { PostBodyEditor } from '../post-body-editor'

const LOCALE_LABEL: Record<string, string> = {
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  fr: 'Français',
}

type Translation = { locale: string; title: string; excerpt: string; bodyHtml: string }

/**
 * 各語系的譯文。沒有譯文的語系，前台顯示中文原文。
 * 分頁第一次打開才掛載編輯器（五個 HTML 編輯器同時跑預覽太重），打開過的保持掛載，切換分頁不會丟掉沒存的字。
 */
export function TranslationEditor({
  postId,
  translations,
}: {
  postId: string
  translations: Translation[]
}) {
  const [active, setActive] = React.useState<string | null>(null)
  const [opened, setOpened] = React.useState<string[]>([])

  function open(locale: string) {
    setActive((cur) => (cur === locale ? null : locale))
    setOpened((prev) => (prev.includes(locale) ? prev : [...prev, locale]))
  }

  return (
    <section className="border border-cream-200 bg-white p-5">
      <h2 className="mb-2 text-sm tracking-[0.1em]">譯文（選填）</h2>
      <p className="mb-4 text-xs text-taupe-500">
        外語訪客會看到對應語系的譯文；沒有譯文的語系顯示中文原文。標題與內文都要填才算數，兩個都清空再儲存就是移除譯文。
        封面、標籤、發布狀態各語系共用。
      </p>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="譯文語系">
        {translations.map((t) => {
          const done = Boolean(t.title && t.bodyHtml)
          return (
            <button
              key={t.locale}
              type="button"
              role="tab"
              aria-selected={active === t.locale}
              onClick={() => open(t.locale)}
              className={cn(
                'inline-flex min-h-10 items-center gap-2 border px-3 text-xs transition-colors sm:min-h-8',
                active === t.locale
                  ? 'border-ink-900 bg-ink-900 text-cream-50'
                  : 'border-cream-300 text-ink-700 hover:border-taupe-400',
              )}
            >
              {LOCALE_LABEL[t.locale] ?? t.locale}
              <span className={cn('text-[10px]', active === t.locale ? 'text-cream-200' : 'text-taupe-500')}>
                {done ? '已翻譯' : '未翻譯'}
              </span>
            </button>
          )
        })}
      </div>

      {translations
        .filter((t) => opened.includes(t.locale))
        .map((t) => (
          <div key={t.locale} hidden={active !== t.locale} className="mt-5">
            <TranslationForm postId={postId} translation={t} />
          </div>
        ))}
    </section>
  )
}

const INITIAL: PostFormState = { ok: false }

function TranslationForm({ postId, translation }: { postId: string; translation: Translation }) {
  const router = useRouter()
  const { toast } = useToast()
  const [state, formAction, pending] = useActionState(savePostTranslation, INITIAL)
  const prefix = `tr-${translation.locale}`

  React.useEffect(() => {
    if (state.ok) {
      toast(state.message ?? '已儲存')
      for (const w of state.warnings ?? []) toast(w, 'error')
      router.refresh()
    }
    if (state.error) toast(state.error, 'error')
  }, [state, toast, router])

  const errors = state.fieldErrors ?? {}

  return (
    <form onSubmit={submitWithoutReset(formAction)} className="space-y-4">
      <input type="hidden" name="postId" value={postId} />
      <input type="hidden" name="locale" value={translation.locale} />

      <Field label="標題" htmlFor={`${prefix}-title`} error={errors.title}>
        <Input id={`${prefix}-title`} name="title" defaultValue={translation.title} maxLength={200} />
      </Field>
      <Field label="摘要" htmlFor={`${prefix}-excerpt`} hint="留白會自動取譯文內文的開頭">
        <Textarea id={`${prefix}-excerpt`} name="excerpt" defaultValue={translation.excerpt} maxLength={500} />
      </Field>
      <div>
        <p className="mb-1.5 text-xs font-medium tracking-wide text-ink-700">內文</p>
        <PostBodyEditor
          id={`${prefix}-body`}
          name="bodyHtml"
          defaultValue={translation.bodyHtml}
          postId={postId}
          error={errors.bodyHtml}
        />
        {errors.bodyHtml && <p className="mt-1 text-xs text-sale">{errors.bodyHtml}</p>}
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          <Save size={15} />
          {pending ? '儲存中…' : `儲存${LOCALE_LABEL[translation.locale] ?? ''}譯文`}
        </Button>
      </div>
    </form>
  )
}
