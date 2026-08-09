import 'server-only'
import { listMessagesAfter, markReadForAgent, markReadForCustomer, toWire } from '.'
import { conversationChannel, onChatEvent } from './bus'
import { formatCursor, parseCursor, type ChatCursor } from './cursor'

/**
 * 對話的 SSE 串流。
 *
 * 三個地方會觸發「去資料庫撈新訊息」：連線建立時、收到 Redis 喚醒訊號時、
 * 以及固定間隔的保險輪詢。最後那個是為了 Redis 斷線的情況 —— 即時性會退化成
 * 十幾秒，但不會整個聊天室啞掉。
 */

const HEARTBEAT_MS = 20_000
const SAFETY_POLL_MS = 15_000

/** 讀取端身分，決定收到新訊息時要清哪一邊的未讀。 */
export type StreamAudience = 'customer' | 'agent'

export function chatEventStream(options: {
  conversationId: string
  since: string | null
  audience: StreamAudience
  signal: AbortSignal
}): Response {
  const { conversationId, audience, signal } = options
  const encoder = new TextEncoder()

  let cursor: ChatCursor | null = parseCursor(options.since)
  let closed = false
  let flushing = false
  let flushAgain = false

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      function write(event: string, data: unknown) {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          // 客戶端已經走了，enqueue 會拋 —— 當成關閉處理即可
          closed = true
        }
      }

      /**
       * 撈游標之後的訊息並送出。
       *
       * 同時被計時器與 Redis 通知呼叫，所以用 flushing 序列化；
       * 執行中又被叫到就記一筆 flushAgain，結束後再跑一次，不會漏也不會重疊。
       */
      async function flush(): Promise<void> {
        if (closed) return
        if (flushing) {
          flushAgain = true
          return
        }
        flushing = true

        try {
          do {
            flushAgain = false
            const messages = await listMessagesAfter(conversationId, cursor)
            if (messages.length === 0) continue

            const last = messages[messages.length - 1]
            cursor = { createdAt: last.createdAt, id: last.id }

            write('messages', {
              cursor: formatCursor(cursor),
              messages: messages.map(toWire),
            })

            // 對方送來的訊息一旦推到畫面上就算讀過了
            const fromOther = messages.some((m) =>
              audience === 'agent' ? m.sender === 'CUSTOMER' : m.sender !== 'CUSTOMER',
            )
            if (fromOther) {
              await (audience === 'agent'
                ? markReadForAgent(conversationId)
                : markReadForCustomer(conversationId))
            }
          } while (flushAgain && !closed)
        } catch (error) {
          console.error('[chat] 串流讀取訊息失敗：', error)
          write('error', { message: '暫時無法取得訊息' })
        } finally {
          flushing = false
        }
      }

      const unsubscribe = onChatEvent(conversationChannel(conversationId), () => {
        void flush()
      })

      const heartbeat = setInterval(() => {
        // 註解行（以 : 開頭）不會觸發前端事件，只用來讓中間的代理不要把連線收掉
        if (closed) return
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          closed = true
        }
      }, HEARTBEAT_MS)

      const safetyPoll = setInterval(() => void flush(), SAFETY_POLL_MS)

      function cleanup() {
        if (closed) return
        closed = true
        clearInterval(heartbeat)
        clearInterval(safetyPoll)
        unsubscribe()
        try {
          controller.close()
        } catch {
          // 已經關了就算了
        }
      }

      signal.addEventListener('abort', cleanup, { once: true })

      write('ready', { conversationId })
      void flush()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      // no-transform 很重要：壓縮中介層會把 SSE 攢成一塊才吐出來
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      // nginx / Caddy 的反向代理緩衝關掉，否則訊息會卡在代理層
      'X-Accel-Buffering': 'no',
    },
  })
}
