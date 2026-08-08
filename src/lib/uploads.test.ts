import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

/**
 * uploads.ts 用 process.cwd() 決定上傳目錄，所以測試前先把工作目錄
 * 換到一個臨時資料夾，才不會把測試檔案寫進專案的 public/。
 */
let workdir: string
let originalCwd: string
let saveProductImages: typeof import('./uploads').saveProductImages
let deleteUploadedFile: typeof import('./uploads').deleteUploadedFile
let deleteProductImageDir: typeof import('./uploads').deleteProductImageDir
let MAX_UPLOAD_BYTES: number

beforeAll(async () => {
  originalCwd = process.cwd()
  workdir = await mkdtemp(path.join(tmpdir(), 'sagon-upload-'))
  process.chdir(workdir)

  const mod = await import('./uploads')
  saveProductImages = mod.saveProductImages
  deleteUploadedFile = mod.deleteUploadedFile
  deleteProductImageDir = mod.deleteProductImageDir
  MAX_UPLOAD_BYTES = mod.MAX_UPLOAD_BYTES
})

afterAll(async () => {
  process.chdir(originalCwd)
  await rm(workdir, { recursive: true, force: true })
})

/** 產生一張真的可以被解碼的測試圖 */
async function makeImage(width: number, height: number, format: 'png' | 'jpeg' = 'png') {
  const img = sharp({ create: { width, height, channels: 3, background: '#c98b7f' } })
  return format === 'png' ? img.png().toBuffer() : img.jpeg().toBuffer()
}

function toFile(buf: Buffer, name: string): File {
  return new File([new Uint8Array(buf)], name, { type: 'image/png' })
}

function diskPath(url: string) {
  return path.join(workdir, 'public', url.replace(/^\//, ''))
}

describe('saveProductImages', () => {
  it('存下圖片並轉成 WebP，回傳公開路徑與尺寸', async () => {
    const file = toFile(await makeImage(800, 600), 'photo.png')
    const result = await saveProductImages('prod123', [file])

    expect(result.failed).toEqual([])
    expect(result.saved).toHaveLength(1)

    const image = result.saved[0]!
    expect(image.url).toMatch(/^\/uploads\/products\/prod123\/[0-9a-f-]+\.webp$/)
    expect(image.width).toBe(800)
    expect(image.height).toBe(600)

    // 檔案真的在磁碟上，而且內容是 WebP
    expect(existsSync(diskPath(image.url))).toBe(true)
    const meta = await sharp(await readFile(diskPath(image.url))).metadata()
    expect(meta.format).toBe('webp')
  })

  it('超過最長邊的圖會被等比縮小', async () => {
    const file = toFile(await makeImage(3200, 2400), 'huge.png')
    const { saved } = await saveProductImages('prod-resize', [file])

    expect(saved[0]!.width).toBe(1600)
    expect(saved[0]!.height).toBe(1200) // 3200x2400 是 4:3，縮到 1600 寬就是 1200 高
  })

  it('小圖不會被放大', async () => {
    const file = toFile(await makeImage(300, 200), 'small.png')
    const { saved } = await saveProductImages('prod-small', [file])

    expect(saved[0]!.width).toBe(300)
    expect(saved[0]!.height).toBe(200)
  })

  it('副檔名假裝是圖片、內容不是圖片的檔案會被拒絕', async () => {
    const evil = new File([new TextEncoder().encode('#!/bin/sh\nrm -rf /')], 'evil.png', {
      type: 'image/png',
    })
    const result = await saveProductImages('prod-evil', [evil])

    expect(result.saved).toEqual([])
    expect(result.failed[0]?.reason).toContain('無法解析')
  })

  it('超過大小上限的檔案會被拒絕，並說出實際大小', async () => {
    const oversized = new File([new Uint8Array(MAX_UPLOAD_BYTES + 1024)], 'big.png', {
      type: 'image/png',
    })
    const result = await saveProductImages('prod-big', [oversized])

    expect(result.saved).toEqual([])
    expect(result.failed[0]?.reason).toMatch(/超過上限/)
  })

  it('一張壞掉不會影響同批其他張', async () => {
    const good = toFile(await makeImage(400, 400), 'good.png')
    const bad = new File([new TextEncoder().encode('not an image')], 'bad.png', {
      type: 'image/png',
    })

    const result = await saveProductImages('prod-mixed', [bad, good])

    expect(result.saved).toHaveLength(1)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]?.filename).toBe('bad.png')
  })

  it('忽略空檔案（瀏覽器沒選檔時會送出空的 File）', async () => {
    const empty = new File([], '', { type: 'application/octet-stream' })
    const result = await saveProductImages('prod-empty', [empty])

    expect(result.saved).toEqual([])
    expect(result.failed).toEqual([])
  })

  it('每次產生不同檔名，同名上傳不會互相覆蓋', async () => {
    const buf = await makeImage(200, 200)
    const result = await saveProductImages('prod-dup', [
      toFile(buf, 'same.png'),
      toFile(buf, 'same.png'),
    ])

    expect(result.saved).toHaveLength(2)
    expect(result.saved[0]!.url).not.toBe(result.saved[1]!.url)
  })
})

describe('deleteUploadedFile', () => {
  it('刪掉上傳目錄裡的檔案', async () => {
    const { saved } = await saveProductImages('prod-del', [
      toFile(await makeImage(100, 100), 'x.png'),
    ])
    const url = saved[0]!.url
    expect(existsSync(diskPath(url))).toBe(true)

    await deleteUploadedFile(url)
    expect(existsSync(diskPath(url))).toBe(false)
  })

  it('檔案不存在時不拋錯（資料庫那筆還是要能刪掉）', async () => {
    await expect(
      deleteUploadedFile('/uploads/products/nope/missing.webp'),
    ).resolves.toBeUndefined()
  })

  it('拒絕用 ../ 跳出上傳目錄刪別的檔案', async () => {
    const victim = path.join(workdir, 'public', 'important.txt')
    await mkdir(path.dirname(victim), { recursive: true })
    await writeFile(victim, 'do not delete')

    await deleteUploadedFile('/uploads/../important.txt')

    expect(existsSync(victim)).toBe(true)
  })

  it('忽略不是本站上傳路徑的網址', async () => {
    await expect(deleteUploadedFile('https://example.com/a.jpg')).resolves.toBeUndefined()
    await expect(deleteUploadedFile('/uploads/seed/1/0.jpg')).resolves.toBeUndefined()
  })
})

describe('deleteProductImageDir', () => {
  it('把整個商品圖片資料夾移除，不留空目錄', async () => {
    const buf = await makeImage(120, 120)
    const { saved } = await saveProductImages('prod-dir', [
      toFile(buf, 'a.png'),
      toFile(buf, 'b.png'),
    ])
    expect(saved).toHaveLength(2)

    const dir = path.join(workdir, 'public', 'uploads', 'products', 'prod-dir')
    expect(existsSync(dir)).toBe(true)

    await deleteProductImageDir('prod-dir')
    expect(existsSync(dir)).toBe(false)
  })

  it('資料夾不存在時不拋錯', async () => {
    await expect(deleteProductImageDir('never-existed')).resolves.toBeUndefined()
  })

  it('商品 id 含路徑跳脫字元時不會刪到別的目錄', async () => {
    const guard = path.join(workdir, 'public', 'uploads', 'guard.txt')
    await mkdir(path.dirname(guard), { recursive: true })
    await writeFile(guard, 'keep me')

    await deleteProductImageDir('../..')

    expect(existsSync(guard)).toBe(true)
  })
})
