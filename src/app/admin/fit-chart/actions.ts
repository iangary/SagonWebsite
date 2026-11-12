'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { db } from '@/lib/db'
import { applyFitChart, planFitChart, type FitChartPlan, type FitInput } from '@/lib/fit-chart/plan'
import { parseFitRows, type SheetIssue } from '@/lib/fit-chart/sheet'
import { MAX_UPLOAD_BYTES, readTable, UnsupportedFileError } from '@/lib/fit-chart/xlsx'

/**
 * 尺寸對照表上傳：先預覽（previewFitChartAction）、確認後寫入（applyFitChartAction）。
 *
 * 寫入時不信任前端送回來的預覽結果 —— 同一個檔案重新解析、重新比對一次，
 * 再用指紋確認跟剛才預覽的是同一份變更；預覽之後資料庫被別人改過就要求重新預覽。
 */

/** 預覽表格最多列幾筆變更；數量本身照實回報 */
const MAX_CHANGES_SHOWN = 300

export interface ChangeView {
  kind: 'create' | 'update' | 'delete'
  productName: string
  size: string
  before: string | null
  after: string | null
}

export type PreviewResult =
  | {
      ok: true
      fileName: string
      fingerprint: string
      counts: FitChartPlan['counts']
      changes: ChangeView[]
      changesTruncated: boolean
      errors: SheetIssue[]
      warnings: SheetIssue[]
    }
  | { ok: false; message: string }

export type ApplyResult = { ok: true; counts: FitChartPlan['counts'] } | { ok: false; message: string }

function describe(fit: FitInput | null): string | null {
  if (!fit) return null
  const range = (label: string, min: number | null, max: number | null, unit: string) =>
    min === null && max === null ? null : `${label} ${min ?? ''}–${max ?? ''}${unit}`
  return [
    range('身高', fit.heightMin, fit.heightMax, 'cm'),
    range('體重', fit.weightMin, fit.weightMax, 'kg'),
    range('胸圍', fit.bustMin, fit.bustMax, 'cm'),
    fit.note ? `備註：${fit.note}` : null,
  ]
    .filter(Boolean)
    .join('　')
}

async function planFromForm(formData: FormData): Promise<{ plan: FitChartPlan; fileName: string } | { message: string }> {
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) return { message: '請先選擇檔案' }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { message: `檔案超過 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB，請確認選的是對照表` }
  }
  let table: string[][]
  try {
    table = await readTable(file.name, new Uint8Array(await file.arrayBuffer()))
  } catch (error) {
    if (error instanceof UnsupportedFileError) return { message: error.message }
    throw error
  }
  const { rows, errors } = parseFitRows(table)
  return { plan: await planFitChart(db, rows, errors), fileName: file.name }
}

export async function previewFitChartAction(formData: FormData): Promise<PreviewResult> {
  await requireAdmin()
  const result = await planFromForm(formData)
  if ('message' in result) return { ok: false, message: result.message }
  const { plan, fileName } = result

  return {
    ok: true,
    fileName,
    fingerprint: plan.fingerprint,
    counts: plan.counts,
    changes: plan.changes.slice(0, MAX_CHANGES_SHOWN).map((c) => ({
      kind: c.kind,
      productName: c.productName,
      size: c.size,
      before: describe(c.before),
      after: describe(c.after),
    })),
    changesTruncated: plan.changes.length > MAX_CHANGES_SHOWN,
    errors: plan.errors,
    warnings: plan.warnings,
  }
}

export async function applyFitChartAction(formData: FormData): Promise<ApplyResult> {
  const admin = await requireAdmin()
  const result = await planFromForm(formData)
  if ('message' in result) return { ok: false, message: result.message }
  const { plan, fileName } = result

  if (plan.errors.length) return { ok: false, message: '檔案裡還有錯誤，整份都沒有寫入。請重新預覽。' }
  if (plan.fingerprint !== formData.get('fingerprint')) {
    return { ok: false, message: '預覽之後資料有變動（或換了檔案），請重新預覽再確認。' }
  }

  await applyFitChart(db, plan)
  await audit({
    userId: admin.id,
    action: 'fit-chart.import',
    entity: 'ProductFit',
    after: { fileName, ...plan.counts },
  })

  revalidatePath('/admin/fit-chart')
  // 首頁的「尺寸推薦」區塊要不要顯示，取決於有沒有適穿資料（hasFitData）
  revalidatePath('/[locale]', 'page')
  return { ok: true, counts: plan.counts }
}
