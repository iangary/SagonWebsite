import 'server-only'
import { hash, verify } from '@node-rs/argon2'

// OWASP 對 Argon2id 的建議參數（19 MiB / t=2 / p=1）
const OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS)
}

export async function verifyPassword(digest: string, plain: string): Promise<boolean> {
  try {
    return await verify(digest, plain, OPTIONS)
  } catch {
    // 雜湊格式壞掉或不是 argon2 → 一律當作驗證失敗，不要往外拋
    return false
  }
}
