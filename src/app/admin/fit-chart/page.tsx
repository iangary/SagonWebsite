import { Download } from 'lucide-react'
import { PageHeader, StatCard } from '@/components/admin/ui'
import { db } from '@/lib/db'
import { MAX_UPLOAD_BYTES } from '@/lib/fit-chart/xlsx'
import { FitChartUpload } from './upload-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: '尺寸對照表' }

const dateTime = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  dateStyle: 'medium',
  timeStyle: 'short',
})

/**
 * 尺寸對照表：每件睡衣（每個尺寸）適合的身高、體重、胸圍範圍。
 * 首頁的「輸入身形，找合身的睡衣」就是拿這張表比對（src/lib/recommend/fit.ts）。
 * 流程：下載目前商品清單 → 在 Excel 填範圍 → 上傳、預覽、確認寫入。
 */
export default async function AdminFitChartPage() {
  const [activeProducts, productsWithFits, fitRows, lastImport] = await Promise.all([
    db.product.count({ where: { status: 'ACTIVE' } }),
    db.product.count({ where: { status: 'ACTIVE', fits: { some: {} } } }),
    db.productFit.count({ where: { product: { status: 'ACTIVE' } } }),
    db.auditLog.findFirst({
      where: { action: 'fit-chart.import' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, user: { select: { name: true, email: true } } },
    }),
  ])

  return (
    <>
      <PageHeader
        title="尺寸對照表"
        description="首頁「輸入身形，找合身的睡衣」用這張表推薦商品與尺寸。至少一件上架商品有資料時，首頁才會出現那一區。"
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <StatCard label="上架商品" value={activeProducts} />
        <StatCard
          label="已填對照表"
          value={productsWithFits}
          hint={activeProducts ? `${Math.round((productsWithFits / activeProducts) * 100)}%` : undefined}
        />
        <StatCard label="尺寸資料列數" value={fitRows} />
        <StatCard
          label="上次匯入"
          value={lastImport ? dateTime.format(lastImport.createdAt) : '—'}
          hint={lastImport ? (lastImport.user?.name ?? lastImport.user?.email ?? undefined) : '還沒有匯入過'}
        />
      </div>

      <ol className="mt-8 space-y-8">
        <Step index={1} title="下載目前的商品清單">
          <p className="text-sm leading-relaxed text-ink-700">
            每件上架商品、每個尺寸一列，已經填過的範圍會帶好。灰底欄位（商品代號、尺寸）用來對應商品，請不要修改；
            檔案裡的「填寫說明」工作表有完整規則。
          </p>
          <a
            href="/api/admin/fit-chart"
            download
            className="mt-4 inline-flex h-11 items-center gap-2 bg-ink-900 px-6 text-sm tracking-wide text-cream-50 transition-colors hover:bg-plum-700"
          >
            <Download size={16} aria-hidden />
            下載對照表（.xlsx）
          </a>
        </Step>

        <Step index={2} title="在 Excel 填好範圍">
          <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink-700">
            <li>身高、體重、胸圍填整數，含邊界；不確定的格子留白＝那一端不設限。</li>
            <li>胸圍是穿的人的胸圍，不是衣服的胸寬。</li>
            <li>範圍全部空白＝這個尺寸沒有資料。不想動的商品可以整列刪掉。</li>
          </ul>
        </Step>

        <Step index={3} title="上傳、預覽、確認寫入">
          <p className="mb-4 text-sm leading-relaxed text-ink-700">
            收 .xlsx 或 .csv，最大 {MAX_UPLOAD_BYTES / 1024 / 1024}MB。檔案裡出現的商品，資料會整份換成檔案內容；
            沒出現的商品不受影響。任何一列有錯，整份都不會寫入。
          </p>
          <FitChartUpload />
        </Step>
      </ol>
    </>
  )
}

function Step({ index, title, children }: { index: number; title: string; children: React.ReactNode }) {
  return (
    <li className="border border-cream-200 bg-white p-5 sm:p-6">
      <h2 className="flex items-center gap-3 text-base tracking-wide text-ink-900">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-cream-100 text-sm text-taupe-600">
          {index}
        </span>
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </li>
  )
}
