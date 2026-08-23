'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth'
import { checkRoleChange } from '@/lib/auth/roles'
import { audit } from '@/lib/audit'
import { db } from '@/lib/db'

/**
 * 把某位會員設成／取消管理員。
 *
 * 沒有邀請流程 —— 對方得先自己註冊（任何一種登入方式都行），
 * 再由現任管理員在會員列表上把他升上來。這樣就不必處理「邀請信寄出後帳號還不存在」
 * 的那一堆狀態，而且權限一定綁在一個已經驗證過登入方式的帳號上。
 */

const schema = z.object({
  userId: z.string().min(1),
  role: z.enum(['CUSTOMER', 'ADMIN']),
})

export type RoleActionResult = { ok: true; message: string } | { ok: false; error: string }

export async function setMemberRole(input: {
  userId: string
  role: 'CUSTOMER' | 'ADMIN'
}): Promise<RoleActionResult> {
  const actor = await requireAdmin()

  const parsed = schema.safeParse(input)
  if (!parsed.success) return { ok: false, error: '參數錯誤' }

  const target = await db.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true, role: true, name: true, email: true, phone: true },
  })
  if (!target) return { ok: false, error: '找不到這位會員' }

  const adminCount = await db.user.count({ where: { role: 'ADMIN' } })
  const verdict = checkRoleChange({
    actorId: actor.id,
    target,
    nextRole: parsed.data.role,
    adminCount,
  })
  if (!verdict.ok) return { ok: false, error: verdict.error }

  const label = target.name ?? target.email ?? target.phone ?? '這位會員'

  try {
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: target.id }, data: { role: parsed.data.role } })
      // 上面那次 count 到這行之間有可能有另一位管理員也被降級。真的降到零就整筆回滾 ——
      // 後台沒有管理員的話只剩改資料庫一條路。
      if ((await tx.user.count({ where: { role: 'ADMIN' } })) === 0) {
        throw new Error('LAST_ADMIN')
      }
    })
  } catch (error) {
    if ((error as Error).message === 'LAST_ADMIN') {
      return { ok: false, error: '至少要保留一位管理員' }
    }
    console.error('[admin] 變更會員權限失敗', error)
    return { ok: false, error: '變更失敗，請重試' }
  }

  await audit({
    userId: actor.id,
    action: parsed.data.role === 'ADMIN' ? 'user.role.grant' : 'user.role.revoke',
    entity: 'User',
    entityId: target.id,
    before: { role: target.role },
    after: { role: parsed.data.role },
  })

  revalidatePath('/admin/members')

  return {
    ok: true,
    message:
      parsed.data.role === 'ADMIN'
        ? `已把「${label}」設為管理員。對方重新載入網站或重新登入後就進得了後台。`
        : `已移除「${label}」的管理員權限，即刻生效。`,
  }
}
