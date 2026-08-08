import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** 新台幣顯示：1280 → NT$1,280 */
export function formatTWD(amount: number): string {
  return `NT$${amount.toLocaleString('zh-TW')}`
}

/** 產生 URL-safe 的 slug。中文會被保留（Next.js 路由支援 unicode）。 */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s/\\]+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
}

/** 截斷字串並補上刪節號，用於 SEO description 與列表摘要。 */
export function truncate(input: string, max: number): string {
  const clean = input.replace(/\s+/g, ' ').trim()
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`
}
