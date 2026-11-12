/**
 * 從命令列匯入尺寸對照表（商品適穿範圍）。
 *
 * 平常請用後台「尺寸對照表」頁（/admin/fit-chart）：下載目前商品清單 → 填好 → 上傳。
 * 這支腳本與後台用同一套解析、驗證與寫入規則（src/lib/fit-chart），留給本機開發或批次測試用。
 *
 * 用法：
 *   npx tsx scripts/import-fit-chart.ts <對照表.xlsx|.csv> --dry-run   只檢查、列出會怎麼變
 *   npx tsx scripts/import-fit-chart.ts <對照表.xlsx|.csv>             寫進資料庫（DATABASE_URL 那一個）
 *
 * 寫入規則：檔案裡出現的商品，適穿資料整份換成檔案的內容；沒出現的商品不動；
 * 任何一列有錯就整份不寫。
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'
import { applyFitChart, planFitChart } from '../src/lib/fit-chart/plan'
import { formatIssue, parseFitRows } from '../src/lib/fit-chart/sheet'
import { readTable } from '../src/lib/fit-chart/xlsx'

async function main() {
  const file = process.argv[2]
  const dryRun = process.argv.includes('--dry-run')
  if (!file) {
    console.error('用法：npx tsx scripts/import-fit-chart.ts <對照表.xlsx|.csv> [--dry-run]')
    process.exit(1)
  }

  const table = await readTable(file, readFileSync(file))
  const { rows, errors } = parseFitRows(table)

  const db = new PrismaClient()
  try {
    const plan = await planFitChart(db, rows, errors)
    for (const w of plan.warnings) console.warn(`⚠ ${formatIssue(w)}`)
    if (plan.errors.length) {
      for (const e of plan.errors) console.error(`✗ ${formatIssue(e)}`)
      console.error(`\n有 ${plan.errors.length} 個錯誤，整份都沒有寫入。改好再重跑。`)
      process.exitCode = 1
      return
    }

    const { products, create, update, delete: remove, unchanged } = plan.counts
    console.log(`共 ${products} 件商品：新增 ${create}、修改 ${update}、刪除 ${remove}、不變 ${unchanged} 個尺寸。`)
    if (dryRun) {
      console.log('（--dry-run：沒有寫入）')
      return
    }
    await applyFitChart(db, plan)
    console.log('已寫入。首頁最晚 5 分鐘後（ISR 重新產生）會反映。')
  } finally {
    await db.$disconnect()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
