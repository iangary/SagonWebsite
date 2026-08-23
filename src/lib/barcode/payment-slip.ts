import { layoutCode39 } from './code39'

/**
 * 超商繳費單的圖檔（SVG）。
 *
 * 為什麼要做成「一張圖」而不只是網頁排版：消費者在超商櫃檯時常常沒有網路，
 * 或者手機瀏覽器被關掉就找不回代碼。做成一張自足的圖，他可以長按存進相簿、
 * 也可以直接列印帶去店裡；店員要刷的是 Code 39 條碼，所以條碼一定要在圖上。
 *
 * 純字串輸出，沒有 DOM 依賴 —— Server Component 直接產生，前端只負責顯示與下載。
 */

export interface PaymentSlipInput {
  shopName: string
  orderNo: string
  amount: number
  /** 綠界回的繳費期限字串（yyyy/MM/dd HH:mm:ss） */
  expireDate: string | null
  /** 超商代碼繳費：一組繳費代碼 */
  paymentNo?: string | null
  /** 超商條碼繳費：三段條碼 */
  barcodes?: (string | null)[]
  /** ATM 轉帳：銀行代碼與虛擬帳號 */
  bankCode?: string | null
  vAccount?: string | null
}

const WIDTH = 640
const PADDING = 32
const INK = '#2b2724'
const MUTED = '#857263'
const LINE = '#e9e2d8'

export function buildPaymentSlipSvg(input: PaymentSlipInput): string {
  const barcodes = (input.barcodes ?? []).filter((b): b is string => Boolean(b))
  const parts: string[] = []
  let y = PADDING

  // 店名與標題
  parts.push(
    text(PADDING, y + 18, input.shopName, { size: 18, letterSpacing: 4 }),
    text(WIDTH - PADDING, y + 18, '超商繳費單', { size: 14, fill: MUTED, anchor: 'end' }),
  )
  y += 34
  parts.push(hr(y))
  y += 28

  // 金額（最大最顯眼 —— 店員與消費者都先看這個）
  parts.push(
    text(PADDING, y, '應繳金額', { size: 12, fill: MUTED }),
    text(WIDTH - PADDING, y + 4, `NT$ ${input.amount.toLocaleString('zh-TW')}`, {
      size: 26,
      anchor: 'end',
    }),
  )
  y += 30

  parts.push(row(y, '訂單編號', input.orderNo))
  y += 24
  parts.push(row(y, '繳費期限', input.expireDate ?? '—'))
  y += 24

  if (input.paymentNo) {
    y += 8
    parts.push(hr(y))
    y += 26
    parts.push(
      text(PADDING, y, '繳費代碼', { size: 12, fill: MUTED }),
      text(WIDTH - PADDING, y + 2, input.paymentNo, {
        size: 20,
        anchor: 'end',
        mono: true,
        letterSpacing: 2,
      }),
    )
    y += 26
    parts.push(
      wrappedNote(y, '請至 7-ELEVEN、全家、萊爾富、OK 的多媒體機台輸入代碼列印繳費單，再至櫃檯繳費。'),
    )
    y += 20
  }

  if (input.bankCode || input.vAccount) {
    y += 8
    parts.push(hr(y))
    y += 26
    parts.push(row(y, '銀行代碼', input.bankCode ?? '—', { mono: true }))
    y += 24
    parts.push(row(y, '虛擬帳號', input.vAccount ?? '—', { mono: true, size: 17 }))
    y += 24
    parts.push(wrappedNote(y, '請以 ATM 或網路銀行轉帳至上方虛擬帳號，金額需完全一致。'))
    y += 20
  }

  if (barcodes.length > 0) {
    y += 8
    parts.push(hr(y))
    y += 24
    parts.push(text(PADDING, y, '請將以下三段條碼交由店員刷讀', { size: 12, fill: MUTED }))
    y += 14

    for (const code of barcodes) {
      const { svg, height } = inlineBarcode(code, y)
      parts.push(svg)
      y += height + 10
    }
  }

  y += 14
  parts.push(hr(y))
  y += 22
  parts.push(
    text(WIDTH / 2, y, '本繳費單由系統產生，逾期後代碼失效，訂單將自動取消。', {
      size: 11,
      fill: MUTED,
      anchor: 'middle',
    }),
  )
  y += PADDING

  const height = Math.ceil(y)

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" ` +
    `viewBox="0 0 ${WIDTH} ${height}" font-family="'Noto Sans TC','Microsoft JhengHei',sans-serif">` +
    `<rect width="100%" height="100%" fill="#ffffff" />` +
    `<rect x="8" y="8" width="${WIDTH - 16}" height="${height - 16}" fill="none" stroke="${LINE}" />` +
    parts.join('') +
    `</svg>`
  )
}

function text(
  x: number,
  y: number,
  value: string,
  options: {
    size?: number
    fill?: string
    anchor?: 'start' | 'middle' | 'end'
    mono?: boolean
    letterSpacing?: number
  } = {},
): string {
  const attrs = [
    `x="${x}"`,
    `y="${y}"`,
    `font-size="${options.size ?? 13}"`,
    `fill="${options.fill ?? INK}"`,
    options.anchor ? `text-anchor="${options.anchor}"` : '',
    options.mono ? `font-family="ui-monospace,'Courier New',monospace"` : '',
    options.letterSpacing ? `letter-spacing="${options.letterSpacing}"` : '',
  ]
    .filter(Boolean)
    .join(' ')
  return `<text ${attrs}>${escapeXml(value)}</text>`
}

function row(
  y: number,
  label: string,
  value: string,
  options: { mono?: boolean; size?: number } = {},
): string {
  return (
    text(PADDING, y, label, { size: 12, fill: MUTED }) +
    text(WIDTH - PADDING, y, value, {
      size: options.size ?? 14,
      anchor: 'end',
      mono: options.mono,
    })
  )
}

function hr(y: number): string {
  return `<line x1="${PADDING}" y1="${y}" x2="${WIDTH - PADDING}" y2="${y}" stroke="${LINE}" />`
}

/** 說明文字。SVG 沒有自動換行，長度固定的句子直接切兩行。 */
function wrappedNote(y: number, note: string): string {
  const limit = 30
  if (note.length <= limit) return text(PADDING, y, note, { size: 11, fill: MUTED })
  return (
    text(PADDING, y, note.slice(0, limit), { size: 11, fill: MUTED }) +
    text(PADDING, y + 15, note.slice(limit), { size: 11, fill: MUTED })
  )
}

/** 把一段條碼畫成 <g>，回傳它佔掉的高度。 */
function inlineBarcode(code: string, top: number): { svg: string; height: number } {
  const barHeight = 46
  const narrow = 2
  const { bars, width } = layoutCode39(code, { narrowWidth: narrow })

  // 太寬就整段等比縮到版面內（條碼比例縮放不影響可讀性）
  const available = WIDTH - PADDING * 2
  const scale = width > available ? available / width : 1
  const offsetX = PADDING + (available - width * scale) / 2

  const rects = bars
    .map(
      (bar) =>
        `<rect x="${bar.x.toFixed(2)}" y="0" width="${bar.width.toFixed(2)}" height="${barHeight}" />`,
    )
    .join('')

  const svg =
    `<g transform="translate(${offsetX.toFixed(2)} ${top + 8}) scale(${scale.toFixed(4)} 1)" fill="#000000">${rects}</g>` +
    text(WIDTH / 2, top + barHeight + 24, code, {
      size: 12,
      mono: true,
      anchor: 'middle',
      letterSpacing: 1,
    })

  return { svg, height: barHeight + 28 }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
