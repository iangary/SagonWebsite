import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { SettingsState } from './actions'

/** 設定頁各張表單共用的欄位元件。 */

export function FormStatus({
  state,
  pending,
  label,
}: {
  state: SettingsState
  pending: boolean
  label: string
}) {
  return (
    <>
      {state.error && (
        <p role="alert" className="border border-sale/30 bg-sale/5 px-4 py-3 text-sm text-sale">
          {state.error}
        </p>
      )}
      {state.ok && state.message && (
        <p className="border border-cream-300 bg-white px-4 py-3 text-sm text-ink-900">
          {state.message}
        </p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? '儲存中…' : label}
      </Button>
    </>
  )
}

export function Section({
  title,
  note,
  children,
}: {
  title: string
  note: string
  children: React.ReactNode
}) {
  return (
    <section className="border border-cream-200 bg-white p-5">
      <h2 className="text-sm tracking-[0.1em] text-ink-900">{title}</h2>
      <p className="mt-1.5 text-xs leading-relaxed text-taupe-600">{note}</p>
      <div className="mt-4">{children}</div>
    </section>
  )
}

export function Check({
  name,
  label,
  defaultChecked,
}: {
  name: string
  label: string
  defaultChecked: boolean
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-900">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="size-4 accent-[#2b2724]"
      />
      {label}
    </label>
  )
}

export function NumberField({
  name,
  label,
  defaultValue,
  min,
  max,
}: {
  name: string
  label: string
  defaultValue: number
  min: number
  max: number
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium tracking-wide text-ink-700">{label}</span>
      <Input
        name={name}
        type="number"
        inputMode="numeric"
        defaultValue={defaultValue}
        min={min}
        max={max}
      />
    </label>
  )
}

export function TextField({
  name,
  label,
  defaultValue,
  placeholder,
  inputMode,
}: {
  name: string
  label: string
  defaultValue: string
  placeholder?: string
  inputMode?: 'numeric'
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium tracking-wide text-ink-700">{label}</span>
      <Input name={name} defaultValue={defaultValue} placeholder={placeholder} inputMode={inputMode} />
    </label>
  )
}
