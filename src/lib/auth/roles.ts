import type { UserRole } from '@prisma/client'

/**
 * 「誰可以把誰設成管理員」的規則。
 *
 * 抽成純函式是為了測得到 —— 下面每一條規則都對應一種「把自己或整間店鎖在後台外面」的手滑，
 * 而這種錯誤要等到有人發現再也進不去後台才會浮出來，那時候只能直接改資料庫。
 */

export type RoleChangeVerdict = { ok: true } | { ok: false; error: string }

export function checkRoleChange(input: {
  /** 按下按鈕的管理員 */
  actorId: string
  target: { id: string; role: UserRole }
  nextRole: UserRole
  /** 目前全站的管理員人數（含 target 自己） */
  adminCount: number
}): RoleChangeVerdict {
  const { actorId, target, nextRole, adminCount } = input

  if (target.role === nextRole) {
    return {
      ok: false,
      error: nextRole === 'ADMIN' ? '這位會員已經是管理員' : '這位會員本來就不是管理員',
    }
  }

  // 自己降自己是最容易把後台鎖死的一步（只剩一位管理員時尤其），一律要另一位管理員來動。
  if (target.id === actorId) {
    return { ok: false, error: '不能改自己的權限，請由另一位管理員操作' }
  }

  // 最後一位管理員被移掉之後，就只剩下改資料庫或重跑 seed 才進得回後台。
  if (nextRole === 'CUSTOMER' && adminCount <= 1) {
    return { ok: false, error: '至少要保留一位管理員' }
  }

  return { ok: true }
}
