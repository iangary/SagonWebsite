'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, AlertCircle, X } from 'lucide-react'
import { cn } from '@/lib/utils'

type ToastKind = 'success' | 'error' | 'info'
type Toast = { id: number; kind: ToastKind; message: string }

const ToastContext = React.createContext<{
  toast: (message: string, kind?: ToastKind) => void
} | null>(null)

export function useToast() {
  const ctx = React.useContext(ToastContext)
  if (!ctx) throw new Error('useToast 必須在 <ToastProvider> 之內使用')
  return ctx
}

const AUTO_DISMISS_MS = 4000

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([])
  const [mounted, setMounted] = React.useState(false)
  const nextId = React.useRef(0)

  React.useEffect(() => setMounted(true), [])

  const dismiss = React.useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = React.useCallback(
    (message: string, kind: ToastKind = 'success') => {
      const id = nextId.current++
      setToasts((prev) => [...prev, { id, kind, message }])
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS)
    },
    [dismiss],
  )

  const value = React.useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {mounted &&
        createPortal(
          <div
            className="pointer-events-none fixed bottom-6 right-6 z-100 flex w-80 flex-col gap-2"
            role="status"
            aria-live="polite"
          >
            {toasts.map((t) => (
              <div
                key={t.id}
                className={cn(
                  'pointer-events-auto flex items-start gap-2.5 border px-4 py-3 text-sm shadow-lg',
                  t.kind === 'error'
                    ? 'border-sale/30 bg-white text-sale'
                    : 'border-cream-300 bg-white text-ink-900',
                )}
              >
                {t.kind === 'error' ? (
                  <AlertCircle className="mt-0.5 shrink-0" size={16} />
                ) : (
                  <CheckCircle2 className="mt-0.5 shrink-0 text-taupe-500" size={16} />
                )}
                <span className="flex-1">{t.message}</span>
                <button
                  onClick={() => dismiss(t.id)}
                  className="shrink-0 text-taupe-400 hover:text-ink-900"
                  aria-label="關閉"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  )
}
