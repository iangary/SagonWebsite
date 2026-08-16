import 'server-only'
import { cookies } from 'next/headers'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'
import { notifyChat } from './bus'
import { normalizeGuestContact } from './contact'
import { previewOf, sanitizeMessageBody, type ChatCursor } from './cursor'

/**
 * 客服聊天的服務層。
 *
 * 訪客身分有兩種來源：登入後的 userId，以及 proxy.ts 發的 sagon_chat cookie。
 * 兩者都拿不到就沒有任何對話可讀 —— 絕不能讓 where 條件退化成「全部」。
 */

export const CHAT_COOKIE = 'sagon_chat'
export const CHAT_COOKIE_MAX_AGE = 60 * 60 * 24 * 90 // 90 天，比購物車長

/** 同一個對話在 RATE_WINDOW_MS 內最多能送幾則，擋洗版。 */
const RATE_LIMIT = 20
const RATE_WINDOW_MS = 60_000

export type ChatViewer = {
  userId: string | null
  anonId: string | null
}

/** 讀出目前訪客的身分。不寫 cookie（render 階段不能寫，由 proxy 負責發）。 */
export async function chatViewer(): Promise<ChatViewer> {
  const [session, jar] = await Promise.all([auth(), cookies()])
  return {
    userId: session?.user?.id ?? null,
    anonId: jar.get(CHAT_COOKIE)?.value ?? null,
  }
}

/** 訪客能看到的對話條件；完全沒有身分時回 null。 */
function viewerWhere(viewer: ChatViewer): Prisma.ConversationWhereInput | null {
  const or: Prisma.ConversationWhereInput[] = []
  if (viewer.userId) or.push({ userId: viewer.userId })
  if (viewer.anonId) or.push({ anonId: viewer.anonId })
  return or.length > 0 ? { OR: or } : null
}

export const CHAT_MESSAGE_SELECT = {
  id: true,
  sender: true,
  body: true,
  createdAt: true,
  author: { select: { name: true } },
} satisfies Prisma.ChatMessageSelect

export type ChatMessageData = Prisma.ChatMessageGetPayload<{
  select: typeof CHAT_MESSAGE_SELECT
}>

/** 傳到瀏覽器的形狀：時間轉 ISO 字串，作者只給名字。 */
export type ChatMessageWire = {
  id: string
  sender: ChatMessageData['sender']
  body: string
  createdAt: string
  authorName: string | null
}

export function toWire(message: ChatMessageData): ChatMessageWire {
  return {
    id: message.id,
    sender: message.sender,
    body: message.body,
    createdAt: message.createdAt.toISOString(),
    authorName: message.author?.name ?? null,
  }
}

export const CONVERSATION_SUMMARY_SELECT = {
  id: true,
  status: true,
  guestName: true,
  guestContact: true,
  lastMessageAt: true,
  lastMessageText: true,
  unreadForAgent: true,
  createdAt: true,
  user: { select: { id: true, name: true, email: true, phone: true } },
} satisfies Prisma.ConversationSelect

export type ConversationSummary = Prisma.ConversationGetPayload<{
  select: typeof CONVERSATION_SUMMARY_SELECT
}>

/**
 * 拉出游標之後的訊息。
 *
 * 條件是 (createdAt, id) 的字典序比較，配合 @@index([conversationId, createdAt, id])；
 * 用單一 createdAt 比較會在同毫秒的兩則訊息上漏掉後者。
 */
export async function listMessagesAfter(
  conversationId: string,
  cursor: ChatCursor | null,
  take = 200,
): Promise<ChatMessageData[]> {
  const after: Prisma.ChatMessageWhereInput | undefined = cursor
    ? {
        OR: [
          { createdAt: { gt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { gt: cursor.id } },
        ],
      }
    : undefined

  return db.chatMessage.findMany({
    where: { conversationId, ...after },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take,
    select: CHAT_MESSAGE_SELECT,
  })
}

/**
 * 登入後把匿名對話收歸帳號。
 *
 * 和購物車合併同一個道理：訪客未登入問了問題，登入後應該還看得到自己的紀錄。
 * 這裡只補 userId，不動 anonId，所以同一台瀏覽器兩種身分都還找得到。
 */
async function claimAnonConversations(userId: string, anonId: string): Promise<void> {
  await db.conversation.updateMany({
    where: { anonId, userId: null },
    data: { userId },
  })
}

/** 訪客目前這一串對話；沒有就回 null。優先拿未結案的那一筆。 */
export async function findViewerConversationId(viewer: ChatViewer): Promise<string | null> {
  const where = viewerWhere(viewer)
  if (!where) return null

  if (viewer.userId && viewer.anonId) {
    await claimAnonConversations(viewer.userId, viewer.anonId)
  }

  const open = await db.conversation.findFirst({
    where: { ...where, status: { not: 'CLOSED' } },
    orderBy: { lastMessageAt: 'desc' },
    select: { id: true },
  })
  if (open) return open.id

  const latest = await db.conversation.findFirst({
    where,
    orderBy: { lastMessageAt: 'desc' },
    select: { id: true },
  })
  return latest?.id ?? null
}

/** 確認這個對話屬於該訪客。SSE 與送訊息都必須先過這關。 */
export async function conversationBelongsToViewer(
  conversationId: string,
  viewer: ChatViewer,
): Promise<boolean> {
  const where = viewerWhere(viewer)
  if (!where) return false

  const found = await db.conversation.findFirst({
    where: { id: conversationId, ...where },
    select: { id: true },
  })
  return found !== null
}

/**
 * 這次送出要不要先問聯絡方式。
 *
 * 只擋「未登入 × 還沒有任何對話」這一格：聊天視窗照樣打得開，
 * 按下送出才要求身分，售前問價的人不會一進來就撞到登入牆。
 * 回頭的訪客靠 sagon_chat cookie 找得到舊對話，不再追問第二次。
 */
export function needsGuestContact(viewer: ChatViewer, conversationId: string | null): boolean {
  return !viewer.userId && conversationId === null
}

export type PostResult =
  | { ok: true; conversationId: string; message: ChatMessageData }
  | {
      ok: false
      error: 'EMPTY' | 'NO_IDENTITY' | 'RATE_LIMITED' | 'CLOSED' | 'CONTACT_REQUIRED' | 'CONTACT_INVALID'
    }

/**
 * 訪客送出一則訊息，必要時開新對話。
 *
 * 節流用資料庫計數而不是 Redis：一則訊息本來就要寫庫，多一次 count 很便宜，
 * 而且 Redis 掛掉時不會退化成完全不設限的公開端點。
 */
export async function postCustomerMessage(input: {
  viewer: ChatViewer
  body: unknown
  guestName?: string | null
  guestContact?: string | null
}): Promise<PostResult> {
  const body = sanitizeMessageBody(input.body)
  if (!body) return { ok: false, error: 'EMPTY' }

  const { viewer } = input
  if (!viewer.userId && !viewer.anonId) return { ok: false, error: 'NO_IDENTITY' }

  const guestName = sanitizeMessageBody(input.guestName)?.slice(0, 60) ?? null

  // 有填就一定要填對，不管是開新對話還是補在既有對話上 ——
  // 存下一個亂填的號碼比留白更糟，客服會以為聯絡得到。
  const rawContact = sanitizeMessageBody(input.guestContact)
  const contact = rawContact ? normalizeGuestContact(rawContact) : null
  if (rawContact && !contact) return { ok: false, error: 'CONTACT_INVALID' }

  const existingId = await findViewerConversationId(viewer)

  if (needsGuestContact(viewer, existingId) && !contact) {
    return { ok: false, error: 'CONTACT_REQUIRED' }
  }

  const guestContact = contact?.value ?? null

  if (existingId) {
    const since = new Date(Date.now() - RATE_WINDOW_MS)
    const recent = await db.chatMessage.count({
      where: { conversationId: existingId, sender: 'CUSTOMER', createdAt: { gte: since } },
    })
    if (recent >= RATE_LIMIT) return { ok: false, error: 'RATE_LIMITED' }
  }

  const { conversationId, message } = await db.$transaction(async (tx) => {
    const id =
      existingId ??
      (
        await tx.conversation.create({
          data: {
            userId: viewer.userId,
            anonId: viewer.anonId,
            guestName,
            guestContact,
          },
          select: { id: true },
        })
      ).id

    const created = await tx.chatMessage.create({
      data: { conversationId: id, sender: 'CUSTOMER', body },
      select: CHAT_MESSAGE_SELECT,
    })

    await tx.conversation.update({
      where: { id },
      data: {
        // 客人再開口就重新變成待處理，即使先前已結案
        status: 'OPEN',
        closedAt: null,
        lastMessageAt: created.createdAt,
        lastMessageText: previewOf(body),
        unreadForAgent: { increment: 1 },
        ...(guestName ? { guestName } : {}),
        ...(guestContact ? { guestContact } : {}),
      },
    })

    return { conversationId: id, message: created }
  })

  await notifyChat(conversationId)
  return { ok: true, conversationId, message }
}

/** 客服回覆。呼叫端必須先過 requireAdmin()。 */
export async function postAgentMessage(input: {
  conversationId: string
  authorId: string
  body: unknown
}): Promise<{ ok: true; message: ChatMessageData } | { ok: false; error: 'EMPTY' | 'NOT_FOUND' }> {
  const body = sanitizeMessageBody(input.body)
  if (!body) return { ok: false, error: 'EMPTY' }

  const exists = await db.conversation.findUnique({
    where: { id: input.conversationId },
    select: { id: true },
  })
  if (!exists) return { ok: false, error: 'NOT_FOUND' }

  const message = await db.$transaction(async (tx) => {
    const created = await tx.chatMessage.create({
      data: {
        conversationId: input.conversationId,
        sender: 'AGENT',
        authorId: input.authorId,
        body,
      },
      select: CHAT_MESSAGE_SELECT,
    })

    await tx.conversation.update({
      where: { id: input.conversationId },
      data: {
        status: 'ANSWERED',
        lastMessageAt: created.createdAt,
        lastMessageText: previewOf(body),
        unreadForAgent: 0,
        unreadForCustomer: { increment: 1 },
      },
    })

    return created
  })

  await notifyChat(input.conversationId)
  return { ok: true, message }
}

/** 客服開啟對話 → 客服端未讀清零。 */
export async function markReadForAgent(conversationId: string): Promise<void> {
  await db.conversation.updateMany({
    where: { id: conversationId, unreadForAgent: { gt: 0 } },
    data: { unreadForAgent: 0 },
  })
}

/** 訪客開啟聊天視窗 → 客人端未讀清零。 */
export async function markReadForCustomer(conversationId: string): Promise<void> {
  await db.conversation.updateMany({
    where: { id: conversationId, unreadForCustomer: { gt: 0 } },
    data: { unreadForCustomer: 0 },
  })
}

/** 結案 / 重新開啟，後台用。 */
export async function setConversationStatus(
  conversationId: string,
  status: 'OPEN' | 'CLOSED',
): Promise<void> {
  await db.conversation.update({
    where: { id: conversationId },
    data: { status, closedAt: status === 'CLOSED' ? new Date() : null },
  })
  await notifyChat(conversationId)
}

/** 後台側邊欄的紅點：還有未讀的對話數。 */
export async function countConversationsAwaitingAgent(): Promise<number> {
  return db.conversation.count({ where: { unreadForAgent: { gt: 0 } } })
}
