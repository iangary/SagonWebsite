'use server'

import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser, unstable_update } from '@/lib/auth'
import { hashPassword } from '@/lib/auth/password'

const schema = z
  .object({
    // 訊息存的是 messages 的 validation.* key，回應時才翻。
    password: z.string().min(8, 'passwordMin').max(128),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'passwordMismatch',
    path: ['confirmPassword'],
  })

export type SetPasswordState = {
  ok: boolean
  error?: string
  fieldErrors?: Record<string, string>
}

/**
 * 手機驗證碼第一次登入後補上密碼。
 *
 * 不需要舊密碼 —— 這條路只服務「還沒有密碼」的帳號。已經有密碼的人要改密碼
 * 得走帳號安全頁（那裡會驗舊密碼），忘記密碼則走 /forgot-password 的簡訊重設。
 */
export async function completePasswordSetup(formData: FormData): Promise<SetPasswordState> {
  const sessionUser = await requireUser()

  const user = await db.user.findUniqueOrThrow({
    where: { id: sessionUser.id },
    select: { passwordHash: true },
  })

  /**
   * 帳號其實已經有密碼了（例如在另一台裝置設過，這邊的 token 還是舊的）。
   *
   * 不改密碼 —— 那會變成「不用舊密碼就能改密碼」的後門。但一定要把旗標關掉放人走，
   * 否則 proxy 會拿舊 token 把他永遠關在這一頁。這個分支刻意排在驗證表單之前，
   * 因為前端那顆「繼續」是送空表單來解鎖的。
   */
  if (user.passwordHash) {
    await unstable_update({ user: { needsPassword: false } })
    leaveGate()
  }

  const parsed = schema.safeParse({
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  })
  if (!parsed.success) {
    const t = await getTranslations('validation')
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0] ?? '_')] ??= t(issue.message)
    }
    return { ok: false, fieldErrors }
  }

  await db.user.update({
    where: { id: sessionUser.id },
    data: { passwordHash: await hashPassword(parsed.data.password) },
  })

  // 在 server 就把 token 上的旗標關掉並重發 cookie，不然 proxy 會把他導回這一頁。
  // 交給 client 的 useSession().update() 不可靠 —— 見 lib/auth/index.ts 的註解。
  await unstable_update({ user: { needsPassword: false } })

  leaveGate()
}

/**
 * 離開這道門也在 server 做。
 *
 * 不能讓 client 在 action 回來之後自己導向 —— 新的 session cookie 是這個 action
 * 回應的一部分，client 端 await 一結束就發下一個請求時，cookie 可能還沒套上，
 * proxy 於是拿舊 token 又把他彈回設定頁（dev 冷編譯時穩定重現）。
 * 由 action redirect 的話，換 cookie 與導向在同一個回應裡，順序由瀏覽器保證。
 */
function leaveGate(): never {
  redirect('/account/orders')
}
