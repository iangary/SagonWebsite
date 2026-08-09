'use client'

import * as React from 'react'
import { Send, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { replyToConversation } from '../actions'

/** 與 `@/lib/chat` 的 ChatMessageWire 同形。 */
type ChatMessage = {
  id: string
  sender: 'CUSTOMER' | 'AGENT' | 'SYSTEM'
  body: string
  createdAt: string
  authorName: string | null
}

export function ConversationThread({
  conversationId,
  initialMessages,
  initialCursor,
  closed,
}: {
  conversationId: string
  initialMessages: ChatMessage[]
  initialCursor: string | null
  closed: boolean
}) {
  const { toast } = useToast()
  const [messages, setMessages] = React.useState(initialMessages)
  const [draft, setDraft] = React.useState('')
  const [sending, setSending] = React.useState(false)

  const cursorRef = React.useRef(initialCursor)
  const listRef = React.useRef<HTMLDivElement>(null)

  const mergeMessages = React.useCallback((incoming: ChatMessage[]) => {
    if (incoming.length === 0) return
    setMessages((current) => {
      const seen = new Set(current.map((m) => m.id))
      const added = incoming.filter((m) => !seen.has(m.id))
      return added.length === 0 ? current : [...current, ...added]
    })
  }, [])

  // 開著這一頁就保持連線，客人一發話立刻看到
  React.useEffect(() => {
    const url = cursorRef.current
      ? `/api/chat/admin/${conversationId}?since=${encodeURIComponent(cursorRef.current)}`
      : `/api/chat/admin/${conversationId}`
    const source = new EventSource(url)

    source.addEventListener('messages', (event) => {
      const payload = JSON.parse((event as MessageEvent<string>).data) as {
        cursor: string
        messages: ChatMessage[]
      }
      cursorRef.current = payload.cursor
      mergeMessages(payload.messages)
    })

    return () => source.close()
  }, [conversationId, mergeMessages])

  React.useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages])

  async function send() {
    const body = draft.trim()
    if (!body || sending) return

    setSending(true)
    const result = await replyToConversation({ conversationId, body })
    setSending(false)

    if (!result.ok) {
      toast(result.error, 'error')
      return
    }
    setDraft('')
    // 回覆本身會經由 SSE 回流，這裡不做樂觀更新，避免同一則出現兩次的視覺跳動
  }

  return (
    <div className="border border-cream-200 bg-white">
      <div ref={listRef} className="max-h-[28rem] space-y-4 overflow-y-auto px-5 py-5">
        {messages.length === 0 ? (
          <p className="py-12 text-center text-sm text-taupe-500">還沒有訊息</p>
        ) : (
          messages.map((message) => <Bubble key={message.id} message={message} />)
        )}
      </div>

      <div className="border-t border-cream-200 p-4">
        {closed && (
          <p className="mb-2 text-xs text-taupe-600">
            這則對話已結案。送出回覆會自動重新開啟。
          </p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Ctrl/⌘ + Enter 送出；後台打長回覆比較多，Enter 保留換行
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void send()
              }
            }}
            rows={3}
            maxLength={2000}
            placeholder="輸入回覆內容（⌘/Ctrl + Enter 送出）"
            className="min-h-20 flex-1 resize-y border border-cream-300 bg-white px-3 py-2 text-sm text-ink-900 outline-none placeholder:text-taupe-500 focus:border-ink-900"
          />
          <Button onClick={() => send()} disabled={sending || draft.trim().length === 0}>
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} strokeWidth={1.5} />}
            送出
          </Button>
        </div>
      </div>
    </div>
  )
}

function Bubble({ message }: { message: ChatMessage }) {
  const fromAgent = message.sender !== 'CUSTOMER'
  const who =
    message.sender === 'CUSTOMER'
      ? '訪客'
      : message.sender === 'SYSTEM'
        ? '系統'
        : (message.authorName ?? '客服')

  return (
    <div className={cn('flex flex-col gap-1', fromAgent ? 'items-end' : 'items-start')}>
      <span className="text-[11px] text-taupe-500">
        {who}　{new Date(message.createdAt).toLocaleString('zh-TW')}
      </span>
      <p
        className={cn(
          'max-w-[80%] whitespace-pre-wrap break-words px-3 py-2 text-sm',
          fromAgent ? 'bg-ink-900 text-cream-50' : 'bg-cream-100 text-ink-900',
        )}
      >
        {message.body}
      </p>
    </div>
  )
}
