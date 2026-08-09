import 'server-only'
import type IORedis from 'ioredis'
import { getRedis } from '@/lib/queue'

/**
 * 聊天的即時通知匯流排。
 *
 * 這裡發出去的只是「某個對話有新東西了，去撈」的喚醒訊號，不是訊息內容本身。
 * 真實資料一律由 SSE 端拿 (createdAt, id) 游標回資料庫查 —— 這樣就算
 * Redis 掉了一個訊息、或訂閱者是中途才連上的，補查時仍然拿得到完整順序，
 * 不會出現只在 Redis 裡存在過的幽靈訊息。
 */

/** 單一對話的頻道，前台聊天視窗與後台對話頁各自訂閱自己那條。 */
export function conversationChannel(conversationId: string): string {
  return `chat:conv:${conversationId}`
}

/** 收件匣頻道，任何對話有動靜都會廣播，後台列表靠它刷新。 */
export const INBOX_CHANNEL = 'chat:inbox'

type Handler = () => void

const globalForBus = globalThis as unknown as {
  chatSubscriber?: IORedis
  chatHandlers?: Map<string, Set<Handler>>
}

/**
 * ioredis 進入 subscribe 模式後就不能再下一般指令，所以一定要用 duplicate()
 * 開一條獨立連線；整個 process 共用這一條，再於記憶體內分派給各個 SSE 連線。
 */
function subscriber(): IORedis {
  if (!globalForBus.chatSubscriber) {
    const client = getRedis().duplicate()
    client.on('error', (error) => {
      // Redis 掛掉只會讓即時性退化成 SSE 的定時補查，不該讓 process 死掉
      console.error('[chat] Redis 訂閱連線錯誤：', error)
    })
    client.on('message', (channel) => {
      for (const handler of globalForBus.chatHandlers?.get(channel) ?? []) {
        try {
          handler()
        } catch (error) {
          console.error('[chat] 通知處理失敗：', error)
        }
      }
    })
    globalForBus.chatSubscriber = client
  }
  return globalForBus.chatSubscriber
}

function handlers(): Map<string, Set<Handler>> {
  globalForBus.chatHandlers ??= new Map()
  return globalForBus.chatHandlers
}

/** 廣播喚醒訊號。失敗只記 log —— 訊息本身已經寫進資料庫了。 */
export async function notifyChat(conversationId: string): Promise<void> {
  try {
    const redis = getRedis()
    await Promise.all([
      redis.publish(conversationChannel(conversationId), '1'),
      redis.publish(INBOX_CHANNEL, conversationId),
    ])
  } catch (error) {
    console.error('[chat] 無法發送即時通知：', error)
  }
}

/**
 * 訂閱一個頻道，回傳取消訂閱的函式。
 *
 * 同一個頻道可能有多條 SSE 連線（客人自己開兩個分頁、兩位客服同時看），
 * 所以 Redis 層只 SUBSCRIBE 一次，記憶體裡用 Set 記住所有 handler。
 */
export function onChatEvent(channel: string, handler: Handler): () => void {
  const map = handlers()
  let set = map.get(channel)

  if (!set) {
    set = new Set()
    map.set(channel, set)
    subscriber()
      .subscribe(channel)
      .catch((error) => console.error(`[chat] 訂閱 ${channel} 失敗：`, error))
  }
  set.add(handler)

  return () => {
    const current = handlers().get(channel)
    if (!current) return
    current.delete(handler)
    if (current.size === 0) {
      handlers().delete(channel)
      subscriber()
        .unsubscribe(channel)
        .catch((error) => console.error(`[chat] 取消訂閱 ${channel} 失敗：`, error))
    }
  }
}
