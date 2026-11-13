/**
 * 後台會員列表匯出成 .xlsx。欄位與 /admin/members 的表格相同，另外拆出角色、停止原因，
 * 數字與日期存成真的數字、日期，Excel 裡可以直接排序、加總。
 * 套件選擇見 src/lib/fit-chart/xlsx.ts 檔頭。
 */
import writeXlsxFile, { type Row } from 'write-excel-file/node'
import { loginMethods, totalSpent, type MemberRow } from './members'

const HEADER_BG = '#2B2724'
const HEADER_TEXT = '#FAF8F5'

const COLUMNS: { title: string; width: number }[] = [
  { title: '姓名', width: 18 },
  { title: 'Email', width: 32 },
  { title: '手機', width: 14 },
  { title: '權限', width: 10 },
  { title: '登入方式', width: 20 },
  { title: '有效訂單', width: 10 },
  { title: '累積消費（NT$）', width: 16 },
  { title: '註冊時間', width: 18 },
  { title: '購買服務', width: 10 },
  { title: '停止日期', width: 12 },
  { title: '停止原因', width: 30 },
]

const text = (value: string | null | undefined) =>
  value ? { value, type: String } : { value: undefined }

/**
 * Excel 的日期沒有時區，write-excel-file 用 UTC 換算。先平移 8 小時，
 * 檔案裡看到的就是台灣時間（不然晚上註冊的會員日期會少一天）。
 */
const taipei = (d: Date) => new Date(d.getTime() + 8 * 60 * 60 * 1000)

export async function buildMembersXlsx(users: MemberRow[]): Promise<Buffer> {
  const header: Row = COLUMNS.map((c) => ({
    value: c.title,
    fontWeight: 'bold',
    backgroundColor: HEADER_BG,
    textColor: HEADER_TEXT,
    align: 'center',
  }))

  const body: Row[] = users.map((u) => [
    text(u.name),
    text(u.email),
    text(u.phone), // 字串：數字格式會吃掉開頭的 0
    text(u.role === 'ADMIN' ? '管理員' : '一般會員'),
    text(loginMethods(u).join('、')),
    { value: u.orders.length, type: Number },
    { value: totalSpent(u), type: Number, format: '#,##0' },
    { value: taipei(u.createdAt), type: Date, format: 'yyyy/mm/dd hh:mm' },
    text(u.purchaseBlockedAt ? '已停止' : '正常'),
    u.purchaseBlockedAt ? { value: taipei(u.purchaseBlockedAt), type: Date, format: 'yyyy/mm/dd' } : { value: undefined },
    text(u.purchaseBlockReason),
  ])

  return writeXlsxFile([header, ...body], {
    sheet: '會員',
    columns: COLUMNS.map((c) => ({ width: c.width })),
    stickyRowsCount: 1,
  }).toBuffer()
}
