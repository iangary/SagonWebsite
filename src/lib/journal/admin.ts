import 'server-only'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { locales } from '@/i18n/config'
import { slugify } from '@/lib/utils'
import { extractProductSlugs } from './html'

/** 後台寫文章用的共用工具（server actions 與匯入 API 共用）。 */

/**
 * 前台文章頁都是動態渲染，這裡清的主要是後台列表；前台的內部路徑也一併清，
 * 日後若改成 ISR 才不會漏。localePrefix: never 的內部路徑仍帶語系前綴（見商品 actions 的說明）。
 */
export function revalidateJournal(slugs: (string | null | undefined)[] = []): void {
  revalidatePath('/admin/journal')
  for (const locale of locales) {
    revalidatePath(`/${locale}/journal`)
    for (const slug of slugs) if (slug) revalidatePath(`/${locale}/journal/${slug}`)
  }
}

export async function slugTaken(slug: string, exceptId?: string): Promise<boolean> {
  const row = await db.post.findUnique({ where: { slug }, select: { id: true } })
  return row !== null && row.id !== exceptId
}

/** 由標題（或指定的代稱）產生還沒被用掉的 slug；撞名往後加 -2、-3。 */
export async function uniquePostSlug(title: string): Promise<string> {
  const base = slugify(title) || `post-${Date.now().toString(36)}`
  for (let n = 1; n <= 50; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`
    if (!(await slugTaken(candidate))) return candidate
  }
  return `${base}-${Date.now().toString(36)}`
}

/** 內文嵌入的商品裡，找不到或沒上架的那些（存檔時提醒，前台會自動略過）。 */
export async function missingEmbeds(...htmls: string[]): Promise<string[]> {
  const slugs = [...new Set(htmls.flatMap((h) => extractProductSlugs(h)))]
  if (slugs.length === 0) return []
  const found = await db.product.findMany({
    where: { slug: { in: slugs }, status: 'ACTIVE' },
    select: { slug: true },
  })
  const ok = new Set(found.map((p) => p.slug))
  return slugs.filter((s) => !ok.has(s))
}

export function missingEmbedWarning(missing: string[]): string[] {
  return missing.length > 0 ? [`內文嵌入的商品找不到或未上架，前台不會顯示：${missing.join('、')}`] : []
}
