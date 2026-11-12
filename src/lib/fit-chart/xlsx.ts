/**
 * 尺寸對照表的 Excel 讀寫。
 *
 * 套件：write-excel-file（寫）＋ read-excel-file（讀），同一位作者、持續維護中，
 * 唯一的共同依賴是 fflate（專案原本就有）。沒選 exceljs：最後一版停在 2023 年，
 * 依賴 archiver 5、unzipper 0.10 這些已不維護的套件；這裡用到的功能（欄寬、凍結列、
 * 底色、讀第一張工作表）兩個小套件都有。
 */
import writeXlsxFile, { type Row, type SheetData } from 'write-excel-file/node'
import { readSheet } from 'read-excel-file/node'
import { COLUMNS, parseDelimited, RANGE_KEYS } from './sheet'
import type { ExportRow } from './plan'

/** 上傳檔案大小上限。全站上架商品約兩三百件、一件幾個尺寸，正常的檔案只有幾十 KB。 */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024

const LOCKED_BG = '#E9E5DE'
const LOCKED_TEXT = '#66574B'
const HEADER_BG = '#2B2724'
const HEADER_TEXT = '#FAF8F5'

const GUIDE_LINES = [
  '尺寸對照表填寫說明',
  '',
  '1. 一列 = 一件商品的一個尺寸。灰底欄位（商品代號、尺寸）是用來對應商品的，請不要修改。',
  '   商品名稱、品牌、有現貨只是方便辨認，改了也不會匯入。',
  '2. 填這件睡衣適合的身高、體重、胸圍範圍（整數，含邊界）。不確定的格子留白＝那一端不設限。',
  '   胸圍是穿的人的胸圍（量胸部最高點一圈），不是衣服的胸寬。',
  '3. 範圍六格全部空白＝這個尺寸沒有資料，首頁不會推薦它。',
  '4. 存檔後到後台「尺寸對照表」上傳，先預覽變更、確認後才會寫入。',
  '   檔案裡出現的商品會整份換成檔案內容（包含刪掉你清空的尺寸）；沒出現在檔案裡的商品不受影響。',
  '   任何一列有錯，整份都不會寫入，預覽會列出是第幾列、哪一欄、什麼原因。',
  '5. 不需要的商品可以整列刪掉（刪掉 = 這次不動它），不用全部填完才能上傳。',
]

export async function buildFitChartXlsx(rows: ExportRow[]): Promise<Buffer> {
  const header: Row = COLUMNS.map((c) => ({
    value: c.title,
    fontWeight: 'bold',
    backgroundColor: HEADER_BG,
    textColor: HEADER_TEXT,
    align: 'center',
  }))

  const body: SheetData = rows.map((r) => {
    const values: Record<string, string | number | null> = {
      product: r.slug,
      name: r.name,
      brand: r.brand,
      size: r.size,
      inStock: r.inStock ? '有' : '無',
      note: r.note,
      ...Object.fromEntries(RANGE_KEYS.map((k) => [k, r[k]])),
    }
    return COLUMNS.map((c) => {
      const value = values[c.key]
      const style = c.locked ? { backgroundColor: LOCKED_BG, textColor: LOCKED_TEXT } : {}
      if (value === null || value === undefined || value === '') return { ...style, value: undefined }
      return typeof value === 'number' ? { ...style, value, type: Number } : { ...style, value, type: String }
    })
  })

  return writeXlsxFile(
    [
      {
        data: [header, ...body],
        sheet: '尺寸對照表',
        columns: COLUMNS.map((c) => ({ width: c.width })),
        stickyRowsCount: 1,
      },
      {
        data: GUIDE_LINES.map((line, i): Row => [i === 0 ? { value: line, fontWeight: 'bold' } : line]),
        sheet: '填寫說明',
        columns: [{ width: 100 }],
      },
    ],
    {},
  ).toBuffer()
}

export class UnsupportedFileError extends Error {}

const isZip = (bytes: Uint8Array) => bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04

/**
 * 上傳的檔案 → 二維字串陣列。.xlsx 讀第一張工作表；.csv／.txt 當 CSV 或 Tab 分隔讀。
 * 副檔名與內容對不上（例如把 .xls 改名成 .xlsx）會丟 UnsupportedFileError。
 */
export async function readTable(fileName: string, bytes: Uint8Array): Promise<string[][]> {
  const ext = fileName.toLowerCase().split('.').pop()
  if (ext === 'xlsx') {
    if (!isZip(bytes)) throw new UnsupportedFileError('檔案內容不是 .xlsx（舊版 .xls 請另存為 .xlsx）')
    let data: unknown[][]
    try {
      data = await readSheet(Buffer.from(bytes), 1)
    } catch {
      throw new UnsupportedFileError('讀不懂這個 Excel 檔，請確認是用 Excel 或 Google 試算表另存的 .xlsx')
    }
    return data.map((row) => row.map((cell) => (cell === null || cell === undefined ? '' : String(cell))))
  }
  if (ext === 'csv' || ext === 'txt' || ext === 'tsv') {
    return parseDelimited(new TextDecoder('utf-8').decode(bytes))
  }
  throw new UnsupportedFileError('只收 .xlsx 或 .csv 檔')
}
