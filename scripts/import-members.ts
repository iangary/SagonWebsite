/**
 * 把舊網站（WACA）匯出的會員資料匯進來。
 *
 * 用法：
 *   npx tsx scripts/import-members.ts "<waca會員資料.xlsx>"            轉成 prisma/seed-data/waca-members.json
 *   npx tsx scripts/import-members.ts prisma/seed-data/waca-members.json --dry-run   只算不寫
 *   npx tsx scripts/import-members.ts prisma/seed-data/waca-members.json             寫進資料庫
 *
 * 分兩步是因為正式站用 worker image 跑，裡面沒有讀 Excel 的套件（fflate 是開發依賴）。
 * JSON 含個資，放在已列入 .gitignore 的 prisma/seed-data/。
 *
 * 匯入什麼：姓名、Email、手機、手機已驗證、加入日期（當作會員的註冊時間）。
 * 沒有密碼 —— 舊系統匯不出來，也不該匯。舊會員都是手機登入，在新網站點「第一次用手機登入？」
 * 收簡訊驗證碼就進得來，接著會被帶去設定密碼（見 lib/auth 的 phone-otp）。
 * 會員等級、消費總額、訂閱電子報、性別、生日新網站沒有對應欄位，不匯。
 *
 * 可重複執行：手機或 Email 已經是會員的，只補空白的欄位，不覆蓋（會員可能已經在新網站改過資料）。
 * 手機屬於一個會員、Email 屬於另一個會員的，跳過並列出來，交給人工判斷。
 */

import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT_JSON = path.join(ROOT, 'prisma', 'seed-data', 'waca-members.json')

export type LegacyMember = {
  /** 舊網站的會員編號，只用來在報表裡指出是哪一筆 */
  legacyId: string
  name: string | null
  email: string | null
  phone: string | null
  phoneVerified: boolean
  /** ISO 字串（台北時間換算過） */
  joinedAt: string | null
}

/** 與 lib/sms/provider.ts 的 normalizeTwMobile 相同規則（這支腳本要能在沒有 src/ 的地方跑） */
export function normalizeTwMobile(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '').replace(/^\+/, '')
  let local = digits
  if (local.startsWith('886')) local = '0' + local.slice(3)
  if (!/^09\d{8}$/.test(local)) return null
  return local
}

export function normalizeEmail(input: string): string | null {
  const email = input.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

/** 「2024-03-05 14:22:10」是台北時間 */
export function parseTaipeiDateTime(input: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(input.trim())
  if (!m) return null
  const [, y, mo, d, h = '00', mi = '00', s = '00'] = m
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}+08:00`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** 一列 Excel（欄名 → 值）轉成會員 */
export function toLegacyMember(row: Record<string, string>): LegacyMember {
  const get = (key: string) => (row[key] ?? '').trim()
  return {
    legacyId: get('會員編號'),
    name: get('姓名') || null,
    email: get('Email') ? normalizeEmail(get('Email')) : null,
    phone: get('電話') ? normalizeTwMobile(get('電話')) : null,
    phoneVerified: get('手機驗證') === '已驗證',
    joinedAt: get('加入日期') ? parseTaipeiDateTime(get('加入日期')) : null,
  }
}

// ---------------------------------------------------------------------------
// Excel → JSON（本機）
// ---------------------------------------------------------------------------

async function readXlsxRows(file: string): Promise<Record<string, string>[]> {
  const { unzipSync, strFromU8 } = await import('fflate')
  const zip = unzipSync(readFileSync(file))
  const decode = (s: string) =>
    s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  const shared = zip['xl/sharedStrings.xml']
    ? [...strFromU8(zip['xl/sharedStrings.xml']).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
        decode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')),
      )
    : []
  const sheet = strFromU8(zip['xl/worksheets/sheet1.xml'])
  const rows = [...sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) =>
    Object.fromEntries(
      [...r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => {
        const type = /t="(\w+)"/.exec(c[2])?.[1]
        const inner = c[3] ?? ''
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1] ?? ''
        return [c[1], type === 's' ? shared[Number(v)] : decode(v)]
      }),
    ),
  )
  const [header, ...body] = rows
  return body.map((row) =>
    Object.fromEntries(Object.entries(header).map(([col, name]) => [name, row[col] ?? ''])),
  )
}

// ---------------------------------------------------------------------------
// JSON → 資料庫
// ---------------------------------------------------------------------------

const mask = (s: string | null) => (s ? `${s.slice(0, 3)}***${s.slice(-2)}` : '—')

async function importMembers(members: LegacyMember[], dryRun: boolean) {
  const db = new PrismaClient()
  const report = { created: 0, filled: 0, unchanged: 0, skipped: [] as string[] }

  try {
    for (const m of members) {
      if (!m.phone && !m.email) {
        report.skipped.push(`${m.legacyId}：沒有可用的手機或 Email`)
        continue
      }
      const [byPhone, byEmail] = await Promise.all([
        m.phone ? db.user.findUnique({ where: { phone: m.phone } }) : null,
        m.email ? db.user.findUnique({ where: { email: m.email } }) : null,
      ])

      if (byPhone && byEmail && byPhone.id !== byEmail.id) {
        report.skipped.push(
          `${m.legacyId}：手機 ${mask(m.phone)} 與 Email ${mask(m.email)} 分屬兩個現有會員，請人工判斷`,
        )
        continue
      }

      const joinedAt = m.joinedAt ? new Date(m.joinedAt) : null
      const existing = byPhone ?? byEmail

      if (!existing) {
        if (!dryRun) {
          await db.user.create({
            data: {
              // 與手機登入自動開帳號的命名一致
              name: m.name ?? (m.phone ? `會員${m.phone.slice(-4)}` : null),
              email: m.email,
              phone: m.phone,
              phoneVerified: m.phone && m.phoneVerified ? (joinedAt ?? new Date()) : null,
              ...(joinedAt ? { createdAt: joinedAt } : {}),
            },
          })
        }
        report.created++
        continue
      }

      // 已經是會員：只補空白的，不覆蓋會員在新網站自己填的資料
      const patch: { name?: string; email?: string; phone?: string; phoneVerified?: Date } = {}
      if (m.name && (!existing.name || /^會員\d{4}$/.test(existing.name))) patch.name = m.name
      if (m.email && !existing.email) patch.email = m.email
      if (m.phone && !existing.phone) patch.phone = m.phone
      if (m.phone && m.phoneVerified && !existing.phoneVerified) patch.phoneVerified = joinedAt ?? new Date()

      if (Object.keys(patch).length === 0) {
        report.unchanged++
        continue
      }
      if (!dryRun) await db.user.update({ where: { id: existing.id }, data: patch })
      report.filled++
    }
  } finally {
    await db.$disconnect()
  }

  console.log(`\n${dryRun ? '（試算，沒有寫入）' : ''}`)
  console.log(`  新建會員 ${report.created} 位`)
  console.log(`  已是會員、補上空白欄位 ${report.filled} 位`)
  console.log(`  已是會員、資料已齊全 ${report.unchanged} 位`)
  console.log(`  跳過 ${report.skipped.length} 位`)
  for (const s of report.skipped) console.log(`    ${s}`)
}

async function main() {
  const file = process.argv[2]
  const dryRun = process.argv.includes('--dry-run')
  if (!file || !existsSync(file)) {
    console.error('用法：npx tsx scripts/import-members.ts <waca會員資料.xlsx | waca-members.json> [--dry-run]')
    process.exit(1)
  }

  if (file.toLowerCase().endsWith('.xlsx')) {
    const members = (await readXlsxRows(file)).map(toLegacyMember)
    const bad = members.filter((m) => !m.phone && !m.email).length
    await mkdir(path.dirname(OUT_JSON), { recursive: true })
    await writeFile(OUT_JSON, JSON.stringify(members, null, 2))
    console.log(`已寫入 ${path.relative(ROOT, OUT_JSON)}：會員 ${members.length} 位`)
    console.log(`  有手機 ${members.filter((m) => m.phone).length}、有 Email ${members.filter((m) => m.email).length}、兩者皆無 ${bad}`)
    console.log('接著：npx tsx scripts/import-members.ts prisma/seed-data/waca-members.json --dry-run')
    return
  }

  const members = JSON.parse(readFileSync(file, 'utf8')) as LegacyMember[]
  await importMembers(members, dryRun)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
