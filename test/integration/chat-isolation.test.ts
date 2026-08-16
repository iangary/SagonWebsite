import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', async () => (await import('./mocks')).authMockModule())
vi.mock('next/headers', async () => (await import('./mocks')).nextHeadersMockModule())
vi.mock('@/lib/queue', async () => (await import('./mocks')).queueMockModule())

/**
 * 聊天的即時喚醒訊號走 Redis。這一檔只驗授權，不驗即時性，
 * 所以把匯流排換成不做事的替身 —— 否則 onChatEvent 會去 getRedis().duplicate()，
 * 而 @/lib/queue 已經被 mock 掉了。
 */
vi.mock('@/lib/chat/bus', () => ({
  conversationChannel: (id: string) => `chat:conv:${id}`,
  INBOX_CHANNEL: 'chat:inbox',
  notifyChat: vi.fn(async () => {}),
  onChatEvent: () => () => {},
}))

import { db } from '@/lib/db'
import { CHAT_COOKIE } from '@/lib/chat'
import { GET as chatOpenGet } from '@/app/api/chat/route'
import { GET as chatStreamGet } from '@/app/api/chat/stream/route'
import { POST as chatMessagesPost } from '@/app/api/chat/messages/route'
import { createTestUser } from '../factories'
import { MemoryCookieJar, mockAuthUser, resetCookieJar, withCookieJar } from './mocks'

/**
 * J-03：對話 id 一律由伺服器決定。
 *
 * 這三支端點目前的寫法本來就是對的 —— 它們只認 cookie / session，
 * 完全沒有「接受用戶端指定 conversationId」的路徑。這一檔是**回歸測試**：
 * 哪天有人為了做「跳到指定對話」之類的功能加上那個參數、卻忘了檢查歸屬，
 * 這裡會立刻紅掉。
 *
 * 之所以值得特別釘住，是因為那種改動一旦漏掉檢查，站上不會有任何錯誤訊息，
 * 只會安靜地把別人的對話（含電話、地址、訂單內容）送出去。
 */

const SECRET = '這是受害者跟客服講的秘密內容，攻擊者不該看到'

/** 建一個屬於某個匿名 id 或會員的對話，並塞一則訊息 */
async function seedConversation(owner: { anonId?: string; userId?: string }, body = SECRET) {
  const conversation = await db.conversation.create({
    data: {
      anonId: owner.anonId ?? null,
      userId: owner.userId ?? null,
      guestContact: owner.anonId ? 'victim@example.com' : null,
      lastMessageText: body,
    },
    select: { id: true },
  })
  await db.chatMessage.create({
    data: { conversationId: conversation.id, sender: 'CUSTOMER', body },
  })
  return conversation.id
}

/** 以某個訪客身分（cookie + 可選的登入者）呼叫端點 */
async function asViewer<T>(
  viewer: { anonId?: string | null; user?: { id: string; role: 'ADMIN' | 'CUSTOMER' } | null },
  fn: () => Promise<T>,
): Promise<T> {
  const jar = new MemoryCookieJar()
  if (viewer.anonId) jar.seed(CHAT_COOKIE, viewer.anonId)
  mockAuthUser(viewer.user ?? null)
  return withCookieJar(jar, fn)
}

/**
 * 把 SSE 讀到「拿得到內容為止」再中止。
 *
 * chatEventStream 一連上就會寫 ready 事件並立刻 flush 一次歷史訊息，
 * 所以短暫讀一下就足以判斷它端出來的是誰的對話。逾時是保險，
 * 沒有東西可讀時不要把測試掛住。
 */
async function readSse(res: Response, ms = 400): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  const deadline = Date.now() + ms

  try {
    while (Date.now() < deadline) {
      const chunk = await Promise.race([
        reader.read(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), deadline - Date.now())),
      ])
      if (!chunk || chunk.done) break
      text += decoder.decode(chunk.value, { stream: true })
      // ready + 首批訊息都到了就不用再等
      if (text.includes('event: messages')) break
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return text
}

function streamRequest(query: string): Request {
  return new Request(`http://localhost:3000/api/chat/stream${query}`)
}

function messagesRequest(payload: Record<string, unknown>): Request {
  return new Request('http://localhost:3000/api/chat/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

type GetHandler = (req: Request) => Promise<Response>
type NoArgHandler = () => Promise<Response>

const chatOpen = chatOpenGet as unknown as NoArgHandler
const chatStream = chatStreamGet as unknown as GetHandler
const chatMessages = chatMessagesPost as unknown as GetHandler

beforeEach(() => {
  vi.clearAllMocks()
  resetCookieJar()
  mockAuthUser(null)
})

describe('GET /api/chat（開場資料）', () => {
  it('只回自己的對話：沒有對話的訪客拿到 null，不會撿到別人的', async () => {
    await seedConversation({ anonId: 'victim-anon' })

    const res = await asViewer({ anonId: 'attacker-anon' }, () => chatOpen())
    const json = (await res.json()) as { conversationId: string | null; messages: unknown[] }

    expect(res.status).toBe(200)
    expect(json.conversationId).toBeNull()
    expect(json.messages).toHaveLength(0)
    expect(JSON.stringify(json)).not.toContain(SECRET)
  })

  it('完全沒有身分（沒 cookie 也沒登入）→ 400，而不是退化成查全部', async () => {
    await seedConversation({ anonId: 'victim-anon' })

    const res = await asViewer({}, () => chatOpen())

    expect(res.status).toBe(400)
    expect(await res.text()).not.toContain(SECRET)
  })

  it('會員 A 看不到會員 B 的對話', async () => {
    const victim = await createTestUser({ email: 'victim-chat@example.com' })
    const attacker = await createTestUser({ email: 'attacker-chat@example.com' })
    await seedConversation({ userId: victim.id })

    const res = await asViewer(
      { user: { id: attacker.id, role: 'CUSTOMER' } },
      () => chatOpen(),
    )
    const json = (await res.json()) as { conversationId: string | null }

    expect(json.conversationId).toBeNull()
  })
})

describe('GET /api/chat/stream（SSE）', () => {
  it('帶別人的 conversationId：參數被忽略，沒有自己的對話就是 204', async () => {
    const victimConversationId = await seedConversation({ anonId: 'victim-anon' })

    const res = await asViewer({ anonId: 'attacker-anon' }, () =>
      chatStream(streamRequest(`?conversationId=${victimConversationId}`)),
    )

    // 204 = 「你還沒有任何對話」。若哪天改成接受 query 指定，這裡會變成 200。
    expect(res.status).toBe(204)
  })

  it('攻擊者自己也有對話時，串流端出來的仍是自己那串', async () => {
    const victimConversationId = await seedConversation({ anonId: 'victim-anon' })
    const ownConversationId = await seedConversation({ anonId: 'attacker-anon' }, '我自己的訊息')

    const res = await asViewer({ anonId: 'attacker-anon' }, () =>
      chatStream(streamRequest(`?conversationId=${victimConversationId}`)),
    )

    expect(res.status).toBe(200)

    const body = await readSse(res)
    expect(body).toContain(ownConversationId)
    expect(body).toContain('我自己的訊息')
    expect(body).not.toContain(victimConversationId)
    expect(body).not.toContain(SECRET)
  })

  it('沒有身分時不開串流', async () => {
    await seedConversation({ anonId: 'victim-anon' })

    const res = await asViewer({}, () => chatStream(streamRequest('')))

    expect(res.status).toBe(400)
  })
})

describe('POST /api/chat/messages', () => {
  it('payload 夾帶別人的 conversationId：訊息落在自己的新對話，受害者那串不受影響', async () => {
    const victimConversationId = await seedConversation({ anonId: 'victim-anon' })

    const res = await asViewer({ anonId: 'attacker-anon' }, () =>
      chatMessages(
        messagesRequest({
          body: '插隊進別人的對話',
          conversationId: victimConversationId,
          guestContact: 'attacker@example.com',
        }),
      ),
    )

    expect(res.status).toBe(200)
    const json = (await res.json()) as { conversationId: string }
    expect(json.conversationId).not.toBe(victimConversationId)

    // 受害者那串仍然只有原本那一則
    const victimMessages = await db.chatMessage.findMany({
      where: { conversationId: victimConversationId },
    })
    expect(victimMessages).toHaveLength(1)
    expect(victimMessages[0]?.body).toBe(SECRET)

    // 攻擊者的訊息確實落在他自己的對話上，且對話歸屬是他的 anonId
    const own = await db.conversation.findUniqueOrThrow({
      where: { id: json.conversationId },
      select: { anonId: true, userId: true },
    })
    expect(own.anonId).toBe('attacker-anon')
    expect(own.userId).toBeNull()
  })

  it('沒有任何身分 → NO_IDENTITY，不會建出無主的對話', async () => {
    const before = await db.conversation.count()

    const res = await asViewer({}, () =>
      chatMessages(messagesRequest({ body: '哈囉', guestContact: 'x@example.com' })),
    )

    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('NO_IDENTITY')
    expect(await db.conversation.count()).toBe(before)
  })

  it('登入後回到同一台瀏覽器：接手的是自己的匿名對話，不會接到別人的', async () => {
    const user = await createTestUser({ email: 'claimer@example.com' })
    const victimConversationId = await seedConversation({ anonId: 'victim-anon' })
    const ownConversationId = await seedConversation({ anonId: 'claimer-anon' }, '登入前問的問題')

    const res = await asViewer(
      { anonId: 'claimer-anon', user: { id: user.id, role: 'CUSTOMER' } },
      () => chatOpen(),
    )
    const json = (await res.json()) as { conversationId: string | null }

    expect(json.conversationId).toBe(ownConversationId)

    // 只有自己那串被掛上 userId，受害者那串一個字都沒動
    const own = await db.conversation.findUniqueOrThrow({ where: { id: ownConversationId } })
    expect(own.userId).toBe(user.id)

    const victim = await db.conversation.findUniqueOrThrow({ where: { id: victimConversationId } })
    expect(victim.userId).toBeNull()
    expect(victim.anonId).toBe('victim-anon')
  })
})
