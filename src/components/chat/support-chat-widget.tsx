'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MessageCircle, X, Send, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

/** 與 `@/lib/chat` 的 ChatMessageWire 同形；client 端不 import server-only 模組。 */
type ChatMessage = {
  id: string
  sender: 'CUSTOMER' | 'AGENT' | 'SYSTEM'
  body: string
  createdAt: string
  authorName: string | null
}

type Bootstrap = {
  conversationId: string | null
  messages: ChatMessage[]
  cursor: string | null
  unread: number
  /** 未登入且還沒開過對話 —— 送出前要先留聯絡方式 */
  requiresContact: boolean
}

export type ChatLabels = {
  open: string
  title: string
  subtitle: string
  greeting: string
  placeholder: string
  send: string
  close: string
  sending: string
  agentFallbackName: string
  you: string
  systemName: string
  failed: string
  contactIntro: string
  nameLabel: string
  namePlaceholder: string
  contactLabel: string
  contactPlaceholder: string
  contactRequired: string
  loginPrompt: string
  loginCta: string
}

const MAX_LENGTH = 2000

export function SupportChatWidget({ labels }: { labels: ChatLabels }) {
  // 登入後導回目前這一頁。用 usePathname 而不是 window.location，
  // SSR 與 hydration 才會算出同一個 href。
  const pathname = usePathname()

  const [open, setOpen] = React.useState(false)
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [unread, setUnread] = React.useState(0)
  const [draft, setDraft] = React.useState('')
  const [sending, setSending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [conversationId, setConversationId] = React.useState<string | null>(null)
  const [requiresContact, setRequiresContact] = React.useState(false)
  const [guestName, setGuestName] = React.useState('')
  const [guestContact, setGuestContact] = React.useState('')

  const cursorRef = React.useRef<string | null>(null)
  const listRef = React.useRef<HTMLDivElement>(null)

  /** 合併新訊息，用 id 去重 —— SSE 補查與樂觀更新可能送來同一則。 */
  const mergeMessages = React.useCallback((incoming: ChatMessage[]) => {
    if (incoming.length === 0) return
    setMessages((current) => {
      const seen = new Set(current.map((m) => m.id))
      const added = incoming.filter((m) => !seen.has(m.id))
      return added.length === 0 ? current : [...current, ...added]
    })
  }, [])

  /*
   * 進站先問一次狀態：有沒有既有對話、有幾則沒讀、要不要先留聯絡方式。
   * 面板關著時也要跑，紅點與聯絡方式表單都靠它。
   *
   * 不要加「只跑一次」的 ref 旗標。StrictMode 下 React 會 mount → cleanup → 再 mount，
   * 旗標會讓第二次直接 return，而第一次的 fetch 已經被 cleanup 的 abort 砍掉 ——
   * 結果是 dev 模式永遠拿不到開場資料。多送一次請求比整組失效便宜。
   */
  React.useEffect(() => {
    const controller = new AbortController()
    fetch('/api/chat', { signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<Bootstrap>) : null))
      .then((data) => {
        if (!data) return
        setConversationId(data.conversationId)
        setMessages(data.messages)
        setUnread(data.unread)
        setRequiresContact(data.requiresContact)
        cursorRef.current = data.cursor
      })
      .catch(() => {
        // 拿不到就當成沒有歷史，使用者送第一則訊息時會重新建立
      })

    return () => controller.abort()
  }, [])

  // SSE 只在面板開著時連線，避免每個開著網站的分頁都佔一條長連線
  React.useEffect(() => {
    if (!open || !conversationId) return

    const url = cursorRef.current
      ? `/api/chat/stream?since=${encodeURIComponent(cursorRef.current)}`
      : '/api/chat/stream'
    const source = new EventSource(url)

    source.addEventListener('messages', (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        cursor: string
        messages: ChatMessage[]
      }
      cursorRef.current = payload.cursor
      mergeMessages(payload.messages)
      setUnread(0)
    })

    return () => source.close()
  }, [open, conversationId, mergeMessages])

  // 有新訊息就滾到底
  React.useEffect(() => {
    if (!open) return
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages, open])

  function openPanel() {
    setOpen(true)
    setUnread(0)
  }

  async function send() {
    const body = draft.trim()
    if (!body || sending) return

    const contact = guestContact.trim()
    // 伺服器才是真正生效的那道；這裡先擋一次，省一趟往返也讓錯誤訊息跟著語系走
    if (requiresContact && !contact) {
      setError(labels.contactRequired)
      return
    }

    setSending(true)
    setError(null)

    try {
      const res = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          requiresContact ? { body, guestName: guestName.trim(), guestContact: contact } : { body },
        ),
      })
      const data = (await res.json()) as
        | { conversationId: string; message: ChatMessage }
        | { error: string; code?: string }

      if (!res.ok || !('message' in data)) {
        setError('error' in data ? data.error : labels.failed)
        // 開場 API 慢一步時 requiresContact 還是 false，表單沒出現、上面那道
        // 前端檢查也跳過。伺服器的拒絕就是把表單叫出來的訊號。
        const code = 'code' in data ? data.code : undefined
        if (code === 'CONTACT_REQUIRED' || code === 'CONTACT_INVALID') {
          setRequiresContact(true)
        }
        return
      }

      setDraft('')
      // 對話開起來了，聯絡方式已經進資料庫，後續發言不用再問
      setRequiresContact(false)
      mergeMessages([data.message])
      // 第一則訊息才會建立對話；設定 id 之後上面的 effect 就會把 SSE 接起來。
      // SSE 開場會把歷史重送一次，mergeMessages 用 id 去重，所以不會出現兩則。
      setConversationId(data.conversationId)
    } catch {
      setError(labels.failed)
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={openPanel}
          aria-label={labels.open}
          className="fixed bottom-5 right-5 z-40 flex size-14 items-center justify-center rounded-full bg-ink-900 text-cream-50 shadow-lg transition-colors hover:bg-ink-700"
        >
          <MessageCircle size={22} strokeWidth={1.5} />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex min-w-5 items-center justify-center rounded-full bg-sale px-1.5 text-xs text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      )}

      {open && (
        <section
          aria-label={labels.title}
          className="fixed inset-x-3 bottom-3 z-40 flex max-h-[min(32rem,85vh)] flex-col border border-cream-300 bg-white shadow-xl sm:inset-x-auto sm:bottom-5 sm:right-5 sm:w-[22rem]"
        >
          <header className="flex items-start justify-between gap-3 border-b border-cream-200 bg-cream-100 px-4 py-3">
            <div>
              <p className="text-sm tracking-wide text-ink-900">{labels.title}</p>
              <p className="mt-0.5 text-xs text-taupe-600">{labels.subtitle}</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={labels.close}
              className="-mr-1 -mt-1 p-1 text-taupe-600 transition-colors hover:text-ink-900"
            >
              <X size={18} strokeWidth={1.5} />
            </button>
          </header>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            <Bubble
              message={{
                id: 'greeting',
                sender: 'SYSTEM',
                body: labels.greeting,
                createdAt: '',
                authorName: null,
              }}
              labels={labels}
            />
            {messages.map((message) => (
              <Bubble key={message.id} message={message} labels={labels} />
            ))}
          </div>

          {requiresContact && (
            <div className="space-y-2 border-t border-cream-200 bg-cream-50 px-4 py-3">
              <p className="text-xs leading-relaxed text-taupe-600">
                {labels.contactIntro}{' '}
                <span className="text-taupe-600">
                  {labels.loginPrompt}{' '}
                  <Link
                    href={`/login?callbackUrl=${encodeURIComponent(pathname)}`}
                    className="text-ink-900 underline underline-offset-2"
                  >
                    {labels.loginCta}
                  </Link>
                </span>
              </p>
              <div className="flex gap-2">
                <label className="flex-1">
                  <span className="sr-only">{labels.nameLabel}</span>
                  <input
                    type="text"
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    maxLength={60}
                    autoComplete="name"
                    placeholder={labels.namePlaceholder}
                    className="h-9 w-full border border-cream-300 bg-white px-2 text-sm text-ink-900 outline-none placeholder:text-taupe-500 focus:border-ink-900"
                  />
                </label>
                <label className="flex-[1.4]">
                  <span className="sr-only">{labels.contactLabel}</span>
                  <input
                    type="text"
                    required
                    value={guestContact}
                    onChange={(e) => setGuestContact(e.target.value)}
                    maxLength={120}
                    autoComplete="email"
                    placeholder={labels.contactPlaceholder}
                    className="h-9 w-full border border-cream-300 bg-white px-2 text-sm text-ink-900 outline-none placeholder:text-taupe-500 focus:border-ink-900"
                  />
                </label>
              </div>
            </div>
          )}

          {error && (
            <p role="alert" className="border-t border-cream-200 px-4 py-2 text-xs text-sale">
              {error}
            </p>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault()
              void send()
            }}
            className="flex items-end gap-2 border-t border-cream-200 p-3"
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter 送出、Shift+Enter 換行，和多數聊天工具一致
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send()
                }
              }}
              rows={2}
              maxLength={MAX_LENGTH}
              placeholder={labels.placeholder}
              className="min-h-11 flex-1 resize-none border border-cream-300 bg-white px-3 py-2 text-sm text-ink-900 outline-none placeholder:text-taupe-500 focus:border-ink-900"
            />
            <Button type="submit" size="icon" disabled={sending || draft.trim().length === 0}>
              {sending ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Send size={16} strokeWidth={1.5} />
              )}
              <span className="sr-only">{sending ? labels.sending : labels.send}</span>
            </Button>
          </form>
        </section>
      )}
    </>
  )
}

function Bubble({ message, labels }: { message: ChatMessage; labels: ChatLabels }) {
  const mine = message.sender === 'CUSTOMER'
  const who =
    message.sender === 'CUSTOMER'
      ? labels.you
      : message.sender === 'SYSTEM'
        ? labels.systemName
        : (message.authorName ?? labels.agentFallbackName)

  return (
    <div className={cn('flex flex-col gap-1', mine ? 'items-end' : 'items-start')}>
      <span className="text-[11px] text-taupe-500">{who}</span>
      <p
        className={cn(
          'max-w-[85%] whitespace-pre-wrap break-words px-3 py-2 text-sm',
          mine ? 'bg-ink-900 text-cream-50' : 'bg-cream-100 text-ink-900',
        )}
      >
        {message.body}
      </p>
    </div>
  )
}
