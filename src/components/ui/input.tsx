import * as React from 'react'
import { cn } from '@/lib/utils'

const fieldClasses =
  'w-full border border-cream-300 bg-white px-3 py-2.5 text-sm text-ink-900 placeholder:text-taupe-400 transition-colors focus:border-taupe-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-cream-100 aria-[invalid=true]:border-sale'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(fieldClasses, className)} {...props} />
  ),
)
Input.displayName = 'Input'

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(fieldClasses, 'min-h-24 resize-y', className)} {...props} />
))
Textarea.displayName = 'Textarea'

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select ref={ref} className={cn(fieldClasses, 'cursor-pointer pr-8', className)} {...props} />
))
Select.displayName = 'Select'

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('mb-1.5 block text-xs font-medium tracking-wide text-ink-700', className)}
      {...props}
    />
  )
}

export function FieldError({ children }: { children?: React.ReactNode }) {
  if (!children) return null
  return <p className="mt-1 text-xs text-sale">{children}</p>
}

/** 表單欄位的標準組合：標籤 + 控制項 + 錯誤訊息 */
export function Field({
  label,
  htmlFor,
  error,
  required,
  hint,
  children,
}: {
  label: string
  htmlFor?: string
  error?: string
  required?: boolean
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="ml-0.5 text-sale">*</span>}
      </Label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-taupe-500">{hint}</p>}
      <FieldError>{error}</FieldError>
    </div>
  )
}
