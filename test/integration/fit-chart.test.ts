import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', async () => (await import('./mocks')).authMockModule())
vi.mock('next/cache', async () => (await import('./mocks')).nextCacheMockModule())
vi.mock('next/headers', async () => (await import('./mocks')).nextHeadersMockModule())

import { readSheet } from 'read-excel-file/node'
import writeXlsxFile from 'write-excel-file/node'
import { db } from '@/lib/db'
import { GET as downloadFitChart } from '@/app/api/admin/fit-chart/route'
import { applyFitChartAction, previewFitChartAction } from '@/app/admin/fit-chart/actions'
import { COLUMNS } from '@/lib/fit-chart/sheet'
import { MAX_UPLOAD_BYTES } from '@/lib/fit-chart/xlsx'
import { createTestAdmin, createTestProduct, createTestUser } from '../factories'
import { mockAuthUser, revalidatePathMock } from './mocks'
import type { User } from '@prisma/client'

let admin: User

beforeEach(async () => {
  vi.clearAllMocks()
  admin = await createTestAdmin()
  mockAuthUser({ id: admin.id, role: 'ADMIN' })
})

async function renameVariants(productId: string, names: string[]) {
  const variants = await db.productVariant.findMany({ where: { productId }, orderBy: { sortOrder: 'asc' } })
  await Promise.all(variants.map((v, i) => db.productVariant.update({ where: { id: v.id }, data: { name: names[i] } })))
}

async function download(): Promise<string[][]> {
  const res = await downloadFitChart()
  expect(res.status).toBe(200)
  const rows = await readSheet(Buffer.from(await res.arrayBuffer()), 1)
  return rows.map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c))))
}

async function xlsxFile(table: (string | number | null)[][], name = 'fit-chart.xlsx'): Promise<File> {
  const buffer = await writeXlsxFile(table.map((r) => r.map((c) => (c === '' ? null : c)))).toBuffer()
  return new File([new Uint8Array(buffer)], name)
}

function form(file: File, fingerprint?: string): FormData {
  const fd = new FormData()
  fd.append('file', file)
  if (fingerprint) fd.append('fingerprint', fingerprint)
  return fd
}

const col = (key: string) => COLUMNS.findIndex((c) => c.key === key)

/** 依欄位 key 改一列的值 */
function setCells(row: (string | number | null)[], values: Record<string, string | number | null>) {
  for (const [key, value] of Object.entries(values)) row[col(key)] = value
  return row
}

describe('GET /api/admin/fit-chart：只給管理員', () => {
  it('訪客、一般會員 → 403', async () => {
    mockAuthUser(null)
    expect((await downloadFitChart()).status).toBe(403)
    const customer = await createTestUser()
    mockAuthUser({ id: customer.id, role: 'CUSTOMER' })
    expect((await downloadFitChart()).status).toBe(403)
  })

  it('每件上架商品、每個尺寸一列，已有的範圍帶好，下架商品不列', async () => {
    const sized = await createTestProduct({ variantCount: 3, name: '分尺寸套裝', stock: 0 })
    await renameVariants(sized.product.id, ['白色M', '白色L', '粉色M'])
    await db.productVariant.update({ where: { id: sized.variants[1].id }, data: { stock: 2 } })
    const free = await createTestProduct({ name: '單一尺寸洋裝' })
    await db.productFit.create({
      data: { productId: free.product.id, size: 'FREE', heightMin: 150, heightMax: 168, note: '偏大' },
    })
    await createTestProduct({ status: 'ARCHIVED', name: '已下架' })

    const res = await downloadFitChart()
    expect(res.headers.get('Content-Type')).toContain('spreadsheetml')
    expect(res.headers.get('Content-Disposition')).toMatch(/attachment; filename="fit-chart-\d{8}\.xlsx"/)

    const [header, ...rows] = await download()
    expect(header).toEqual(COLUMNS.map((c) => c.title))
    const pick = (r: string[]) => [r[col('name')], r[col('size')], r[col('inStock')], r[col('heightMin')], r[col('heightMax')], r[col('note')]]
    expect(rows.map(pick).sort()).toEqual(
      [
        ['分尺寸套裝', 'M', '無', '', '', ''],
        ['分尺寸套裝', 'L', '有', '', '', ''],
        ['單一尺寸洋裝', 'FREE', '有', '150', '168', '偏大'],
      ].sort(),
    )
  })

  it('資料庫裡有、但規格已經沒有的尺寸也列出來（不然重新上傳會被靜靜刪掉）', async () => {
    const p = await createTestProduct()
    await db.productFit.create({ data: { productId: p.product.id, size: 'XL', weightMin: 60 } })
    const rows = (await download()).slice(1)
    expect(rows.map((r) => r[col('size')]).sort()).toEqual(['FREE', 'XL'])
  })
})

describe('上傳：預覽 → 確認寫入', () => {
  it('下載 → 填幾格 → 上傳：預覽列出新增／修改／刪除，確認後寫入並留稽核紀錄', async () => {
    const a = await createTestProduct({ name: '甲' })
    const b = await createTestProduct({ name: '乙' })
    const untouched = await createTestProduct({ name: '丙（檔案裡刪掉這列）' })
    await db.productFit.createMany({
      data: [
        { productId: b.product.id, size: 'FREE', heightMin: 150, heightMax: 160 },
        { productId: untouched.product.id, size: 'FREE', weightMax: 50 },
      ],
    })

    const table: (string | number | null)[][] = await download()
    const rowOf = (name: string) => table.find((r) => r[col('name')] === name)!
    setCells(rowOf('甲'), { heightMin: 150, heightMax: 165, weightMin: 40, weightMax: 55 })
    setCells(rowOf('乙'), { heightMin: null, heightMax: null }) // 清空 → 刪除
    table.splice(table.indexOf(rowOf('丙（檔案裡刪掉這列）')), 1) // 整列刪掉 → 不動

    const file = await xlsxFile(table)
    const preview = await previewFitChartAction(form(file))
    expect(preview).toMatchObject({ ok: true, errors: [], counts: { products: 2, create: 1, update: 0, delete: 1, unchanged: 0 } })
    if (!preview.ok) throw new Error('unreachable')
    expect(preview.changes).toHaveLength(2)
    expect(preview.changes).toEqual(
      expect.arrayContaining([
        { kind: 'create', productName: '甲', size: 'FREE', before: null, after: '身高 150–165cm　體重 40–55kg' },
        { kind: 'delete', productName: '乙', size: 'FREE', before: '身高 150–160cm', after: null },
      ]),
    )
    // 預覽不寫入
    expect(await db.productFit.count()).toBe(2)

    const result = await applyFitChartAction(form(file, preview.fingerprint))
    expect(result).toEqual({ ok: true, counts: preview.counts })

    const fits = await db.productFit.findMany({ select: { productId: true, heightMax: true, weightMax: true } })
    expect(fits).toEqual(
      expect.arrayContaining([
        { productId: a.product.id, heightMax: 165, weightMax: 55 },
        { productId: untouched.product.id, heightMax: null, weightMax: 50 },
      ]),
    )
    expect(fits).toHaveLength(2)

    const log = await db.auditLog.findFirstOrThrow({ where: { action: 'fit-chart.import' } })
    expect(log).toMatchObject({ userId: admin.id, entity: 'ProductFit' })
    expect(revalidatePathMock).toHaveBeenCalledWith('/[locale]', 'layout')
  })

  it('重複下載再原樣上傳：沒有任何變更', async () => {
    const p = await createTestProduct()
    await db.productFit.create({ data: { productId: p.product.id, size: 'FREE', heightMin: 150, bustMax: 90, note: '備註' } })
    const preview = await previewFitChartAction(form(await xlsxFile(await download())))
    expect(preview).toMatchObject({ ok: true, counts: { create: 0, update: 0, delete: 0, unchanged: 1 } })
  })

  it('有錯誤時預覽列出第幾列、哪一欄、為什麼，而且寫入被拒絕', async () => {
    await createTestProduct({ name: '甲' })
    const table: (string | number | null)[][] = await download()
    setCells(table[1], { heightMin: 170, heightMax: 160, weightMin: 'abc' })
    table.push(setCells(Array(COLUMNS.length).fill(null), { product: 'no-such-product', size: 'M', heightMin: 150 }))

    const file = await xlsxFile(table)
    const preview = await previewFitChartAction(form(file))
    if (!preview.ok) throw new Error('unreachable')
    expect(preview.errors).toEqual([
      { line: 2, column: '體重下限(kg)', message: '「abc」不是數字' },
      { line: 2, column: '身高下限(cm)', message: '身高下限 170 大於上限 160' },
      { line: 3, column: '商品代號', message: '找不到商品「no-such-product」' },
    ])

    const result = await applyFitChartAction(form(file, preview.fingerprint))
    expect(result).toEqual({ ok: false, message: '檔案裡還有錯誤，整份都沒有寫入。請重新預覽。' })
    expect(await db.productFit.count()).toBe(0)
  })

  it('預覽之後資料被改過（指紋對不上）就拒絕寫入', async () => {
    const p = await createTestProduct({ name: '甲' })
    const table: (string | number | null)[][] = await download()
    setCells(table[1], { heightMin: 150, heightMax: 165 })
    const file = await xlsxFile(table)
    const preview = await previewFitChartAction(form(file))
    if (!preview.ok) throw new Error('unreachable')

    // 別人在預覽後先寫了一筆
    await db.productFit.create({ data: { productId: p.product.id, size: 'FREE', heightMin: 140 } })
    const result = await applyFitChartAction(form(file, preview.fingerprint))
    expect(result).toEqual({ ok: false, message: '預覽之後資料有變動（或換了檔案），請重新預覽再確認。' })
    expect((await db.productFit.findFirstOrThrow()).heightMin).toBe(140)
  })

  it('也收 CSV（含 BOM）', async () => {
    const p = await createTestProduct()
    const csv = `﻿商品代號,尺寸,體重下限(kg),體重上限(kg)\n${p.product.slug},FREE,40,55\n`
    const preview = await previewFitChartAction(form(new File([csv], 'fit.csv')))
    expect(preview).toMatchObject({ ok: true, errors: [], counts: { create: 1 } })
  })

  it.each([
    ['沒選檔案', () => new File([], 'x.xlsx'), '請先選擇檔案'],
    ['副檔名不對', () => new File(['hello'], 'x.pdf'), '只收 .xlsx 或 .csv 檔'],
    ['假的 xlsx', () => new File(['not a zip'], 'x.xlsx'), '檔案內容不是 .xlsx（舊版 .xls 請另存為 .xlsx）'],
    ['超過大小上限', () => new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], 'x.xlsx'), '檔案超過 2MB，請確認選的是對照表'],
  ])('%s → 明確的錯誤訊息', async (_label, makeFile, message) => {
    expect(await previewFitChartAction(form(makeFile()))).toEqual({ ok: false, message })
  })
})
