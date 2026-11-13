import type { PostStatus } from '@prisma/client'

/** 後台列表與編輯頁共用的狀態文字。「排程中」= 已設為發布但時間還沒到，前台還看不到。 */
export function postStatusLabel(
  status: PostStatus,
  publishedAt: Date | null,
  now: Date,
): { text: string; tone: 'success' | 'warning' | 'muted' } {
  if (status === 'DRAFT') return { text: '草稿', tone: 'muted' }
  if (publishedAt && publishedAt > now) return { text: '排程中', tone: 'warning' }
  return { text: '已發布', tone: 'success' }
}
